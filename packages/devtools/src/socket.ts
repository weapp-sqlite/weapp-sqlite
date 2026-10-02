export interface SqliteDevtoolsSocketHandlers {
  readonly open: () => void
  readonly message: (data: string) => void
  readonly close: () => void
  readonly error: () => void
}

export interface SqliteDevtoolsSocket {
  send: (data: string) => void
  close: () => void
}

export type SqliteDevtoolsSocketFactory = (url: string, handlers: SqliteDevtoolsSocketHandlers) => SqliteDevtoolsSocket

function toBinaryBytes(value: unknown): Uint8Array | undefined {
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength)
  }
  return undefined
}

function decodeUtf8(value: unknown): string | undefined {
  if (typeof value === 'string') { return value }
  const bytes = toBinaryBytes(value)
  if (!bytes) { return undefined }
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    catch {
      return undefined
    }
  }
  // TextDecoder is not available in some older mini-program runtimes. The
  // protocol is UTF-8 JSON, so keep a small standards-compliant fallback
  // instead of coercing bytes to Latin-1 and corrupting non-ASCII payloads.
  let output = ''
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++] ?? -1
    if (first <= 0x7F) {
      output += String.fromCharCode(first)
      continue
    }
    const continuation = (count: number) => {
      if (index + count > bytes.length) { return undefined }
      let codePoint = 0
      for (let offset = 0; offset < count; offset++) {
        const next = bytes[index++] ?? -1
        if ((next & 0xC0) !== 0x80) { return undefined }
        codePoint = (codePoint << 6) | (next & 0x3F)
      }
      return codePoint
    }
    let codePoint: number | undefined
    if (first >= 0xC2 && first <= 0xDF) {
      const next = bytes[index++] ?? -1
      if ((next & 0xC0) === 0x80) { codePoint = ((first & 0x1F) << 6) | (next & 0x3F) }
    }
    else if (first >= 0xE0 && first <= 0xEF) {
      const second = bytes[index++] ?? -1
      const validSecond = (first === 0xE0 && second >= 0xA0 && second <= 0xBF)
        || (first === 0xED && second >= 0x80 && second <= 0x9F)
        || (first !== 0xE0 && first !== 0xED && second >= 0x80 && second <= 0xBF)
      if (validSecond) {
        const next = continuation(1)
        if (next !== undefined) { codePoint = ((first & 0x0F) << 12) | ((second & 0x3F) << 6) | next }
      }
    }
    else if (first >= 0xF0 && first <= 0xF4) {
      const second = bytes[index++] ?? -1
      const validSecond = (first === 0xF0 && second >= 0x90 && second <= 0xBF)
        || (first === 0xF4 && second >= 0x80 && second <= 0x8F)
        || (first !== 0xF0 && first !== 0xF4 && second >= 0x80 && second <= 0xBF)
      if (validSecond) {
        const next = continuation(2)
        if (next !== undefined) { codePoint = ((first & 0x07) << 18) | ((second & 0x3F) << 12) | next }
      }
    }
    if (codePoint === undefined || codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
      return undefined
    }
    output += String.fromCodePoint(codePoint)
  }
  return output
}

export interface SqliteDevtoolsWebSocket {
  send: (data: string) => void
  close: () => void
  addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => void
}

export function createWebSocketFactory(Constructor: new (url: string) => SqliteDevtoolsWebSocket): SqliteDevtoolsSocketFactory {
  return (url, handlers) => {
    let socket: SqliteDevtoolsWebSocket | undefined
    let ended = false
    let underlyingClosed = false

    function closeUnderlying() {
      if (!socket || underlyingClosed) { return }
      underlyingClosed = true
      try { socket.close() }
      catch { /* WebSocket may already be closed by the host. */ }
    }

    function fail() {
      if (ended) { return }
      ended = true
      closeUnderlying()
      handlers.error()
    }

    try {
      socket = new Constructor(url)
      socket.addEventListener('open', () => { if (!ended) { handlers.open() } })
      socket.addEventListener('message', (event) => {
        if (ended) { return }
        const data = decodeUtf8(event.data)
        if (data === undefined) {
          fail()
          return
        }
        handlers.message(data)
      })
      socket.addEventListener('close', () => {
        if (ended) { return }
        ended = true
        handlers.close()
      })
      socket.addEventListener('error', fail)
    }
    catch {
      fail()
    }
    return {
      send(data) {
        if (ended || !socket) { return }
        try { socket.send(data) }
        catch { fail() }
      },
      close() {
        if (ended) { return }
        ended = true
        closeUnderlying()
      },
    }
  }
}

export interface SqliteDevtoolsWeappSocketTask {
  send: (options: { data: string, fail?: () => void }) => void
  close: (options: { code: number, reason: string }) => void
  onOpen: (handler: () => void) => void
  onMessage: (handler: (event: { data: string | ArrayBuffer }) => void) => void
  onClose: (handler: () => void) => void
  onError: (handler: () => void) => void
}

export interface SqliteDevtoolsWeappSocketApi {
  connectSocket: (options: { url: string, success: () => void, fail: () => void }) => SqliteDevtoolsWeappSocketTask
}

/** 直接使用 SocketTask，不依赖浏览器全局变量或动态求值。 */
export function createWeappSocketFactory(api: SqliteDevtoolsWeappSocketApi): SqliteDevtoolsSocketFactory {
  return (url, handlers) => {
    let task: SqliteDevtoolsWeappSocketTask | undefined
    let ended = false
    let underlyingClosed = false

    function closeUnderlying() {
      if (!task || underlyingClosed) { return }
      underlyingClosed = true
      try { task.close({ code: 1000, reason: 'SQLite DevTools closed' }) }
      catch { /* SocketTask may already be closed by the host. */ }
    }

    function fail() {
      if (ended) { return }
      ended = true
      closeUnderlying()
      handlers.error()
    }

    function handleMessage(event: { data: string | ArrayBuffer }) {
      if (ended) { return }
      const data = decodeUtf8(event.data)
      if (data === undefined) {
        fail()
        return
      }
      handlers.message(data)
    }

    try {
      // `fail` can be invoked synchronously by a host mock or an unavailable
      // runtime before connectSocket returns its SocketTask. Keep the task
      // reference and close it as soon as it becomes available.
      task = api.connectSocket({ url, success: () => {}, fail })
      if (!task) { throw new Error('wx.connectSocket did not return a SocketTask.') }
      if (ended) {
        closeUnderlying()
      }
      else {
        task.onOpen(() => { if (!ended) { handlers.open() } })
        task.onMessage(handleMessage)
        task.onClose(() => {
          if (ended) { return }
          ended = true
          handlers.close()
        })
        task.onError(fail)
      }
    }
    catch {
      fail()
    }
    return {
      send(data) {
        if (ended || !task) { return }
        try { task.send({ data, fail }) }
        catch { fail() }
      },
      close() {
        if (ended) { return }
        ended = true
        closeUnderlying()
      },
    }
  }
}

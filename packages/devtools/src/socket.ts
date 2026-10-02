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

export interface SqliteDevtoolsWebSocket {
  send: (data: string) => void
  close: () => void
  addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => void
}

export function createWebSocketFactory(Constructor: new (url: string) => SqliteDevtoolsWebSocket): SqliteDevtoolsSocketFactory {
  return (url, handlers) => {
    const socket = new Constructor(url)
    socket.addEventListener('open', handlers.open)
    socket.addEventListener('message', event => typeof event.data === 'string' ? handlers.message(event.data) : handlers.error())
    socket.addEventListener('close', handlers.close)
    socket.addEventListener('error', handlers.error)
    return { send: data => socket.send(data), close: () => socket.close() }
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
    const task = api.connectSocket({ url, success: () => {}, fail: handlers.error })
    task.onOpen(handlers.open)
    task.onMessage(event => typeof event.data === 'string' ? handlers.message(event.data) : handlers.error())
    task.onClose(handlers.close)
    task.onError(handlers.error)
    return {
      send: data => task.send({ data, fail: handlers.error }),
      close: () => task.close({ code: 1000, reason: 'SQLite DevTools closed' }),
    }
  }
}

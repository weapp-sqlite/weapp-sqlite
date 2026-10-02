/* eslint-disable ts/no-use-before-define */
import type { SqliteDebugController } from '@weapp-sqlite/debug'
import type { SqliteDevtoolsRuntime } from './protocol'
import type { SqliteDevtoolsSocket, SqliteDevtoolsSocketFactory } from './socket'
import {
  decodeSqliteDevtoolsValue,
  encodeSqliteDevtoolsValue,
  isIdentifier,
  isRecord,
  isSqliteDevtoolsMethod,
  isSqliteDevtoolsWriteMethod,
  serializeDevtoolsError,
  SQLITE_DEVTOOLS_MAX_MESSAGE_BYTES,
  SQLITE_DEVTOOLS_PROTOCOL,
  SqliteDevtoolsError,
  validDatabaseNames,
} from './protocol'

export interface ConnectSqliteDevtoolsRuntimeOptions {
  readonly endpoint: string
  readonly token: string
  readonly runtime: SqliteDevtoolsRuntime
  readonly listDatabases: () => readonly string[]
  readonly getController: (databaseName: string) => SqliteDebugController | Promise<SqliteDebugController>
  readonly createSocket: SqliteDevtoolsSocketFactory
  readonly onDisconnect?: () => void
  readonly reconnectDelayMs?: number
}

export interface SqliteDevtoolsRuntimeConnection {
  refresh: () => void
  close: () => void
}

function utf8ByteLength(value: string) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength
  }
  let bytes = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    bytes += codePoint <= 0x7F ? 1 : codePoint <= 0x7FF ? 2 : codePoint <= 0xFFFF ? 3 : 4
  }
  return bytes
}

/** 只登记和转发当前运行时的数据库，断线后不重放任何数据库操作。 */
export function connectSqliteDevtoolsRuntime(options: ConnectSqliteDevtoolsRuntimeOptions): SqliteDevtoolsRuntimeConnection {
  if (!/^ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//.test(options.endpoint)
    || !options.token || !isIdentifier(options.runtime.id) || !isIdentifier(options.runtime.label) || !isIdentifier(options.runtime.platform)) {
    throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_INVALID_CONFIG', 'SQLite DevTools requires a loopback endpoint and valid runtime identity.')
  }
  let disposed = false
  let generation = 0
  let socket: SqliteDevtoolsSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let authTimer: ReturnType<typeof setTimeout> | undefined
  let sessionId: string | undefined
  let allowWrite = false
  let requestIds = new Set<string>()
  let reconnectAttempt = 0

  function databases() {
    const names = [...options.listDatabases()]
    if (!validDatabaseNames(names)) {
      throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_INVALID_CONFIG', 'SQLite DevTools database names are invalid.')
    }
    return names
  }

  function send(payload: unknown) {
    const text = JSON.stringify(payload)
    if (utf8ByteLength(text) > SQLITE_DEVTOOLS_MAX_MESSAGE_BYTES) {
      throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_PAYLOAD_LIMIT', 'SQLite DevTools message exceeds the size limit.')
    }
    socket?.send(text)
  }

  function disconnect(current: number) {
    if (current !== generation) { return }
    generation += 1
    sessionId = undefined
    requestIds.clear()
    clearTimeout(authTimer)
    const previous = socket
    socket = undefined
    try { previous?.close() }
    catch { /* 宿主可能已关闭连接。 */ }
    try { options.onDisconnect?.() }
    catch { /* 释放调试资源的回调不能阻断重连状态机。 */ }
    if (!disposed && !reconnectTimer) {
      const delay = Math.min(5000, (options.reconnectDelayMs ?? 500) * 2 ** Math.min(reconnectAttempt++, 4))
      reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect() }, delay)
    }
  }

  async function receive(text: string, current: number) {
    if (disposed || current !== generation) { return }
    try {
      if (utf8ByteLength(text) > SQLITE_DEVTOOLS_MAX_MESSAGE_BYTES) { throw new Error('Oversized message') }
      const message: unknown = JSON.parse(text)
      if (!isRecord(message)) { throw new Error('Invalid message') }
      if (message.type === 'ready' && isIdentifier(message.sessionId) && typeof message.allowWrite === 'boolean') {
        if (sessionId) { throw new Error('Duplicate handshake') }
        clearTimeout(authTimer)
        sessionId = message.sessionId
        allowWrite = message.allowWrite
        reconnectAttempt = 0
        return
      }
      if (message.type !== 'request' || !sessionId || message.sessionId !== sessionId || !isIdentifier(message.requestId)) {
        throw new Error('Invalid runtime request')
      }
      if (requestIds.has(message.requestId) || requestIds.size >= 100_000) {
        throw new Error('Duplicate or excessive request ids')
      }
      requestIds.add(message.requestId)
      const requestId = message.requestId
      const requestedSession = sessionId
      let result
      try {
        if (!isSqliteDevtoolsMethod(message.method) || message.method === 'close' || !isIdentifier(message.databaseName) || !databases().includes(message.databaseName)) {
          throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_INVALID_REQUEST', 'Unknown SQLite database or operation.')
        }
        if (!allowWrite && isSqliteDevtoolsWriteMethod(message.method)) {
          throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_READ_ONLY', 'This SQLite DevTools session is read-only.')
        }
        const args = decodeSqliteDevtoolsValue(message.args)
        if (!Array.isArray(args) || args.length > 8) {
          throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_INVALID_REQUEST', 'SQLite operation arguments must be an array.')
        }
        const controller = await options.getController(message.databaseName)
        // 在异步获取控制器后再次核对代际，旧会话不能开始新的 SQL 操作。
        if (disposed || current !== generation || requestedSession !== sessionId) { return }
        // Controller lookup may span a database replacement/removal. Re-read
        // the registry before invoking it so a request cannot run against a
        // controller that is no longer advertised by this runtime.
        if (!databases().includes(message.databaseName)) {
          throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_DATABASE_CLOSED', 'The selected SQLite database is no longer registered.')
        }
        const handler = controller[message.method] as (...args: unknown[]) => unknown
        const value = await handler.apply(controller, args)
        result = { ok: true, value: encodeSqliteDevtoolsValue(value) }
      }
      catch (error) { result = { ok: false, error: serializeDevtoolsError(error) } }
      if (!disposed && current === generation && requestedSession === sessionId) {
        send({ type: 'result', sessionId, requestId, result })
      }
    }
    catch { disconnect(current) }
  }

  function connect() {
    if (disposed) { return }
    const current = ++generation
    requestIds = new Set()
    try {
      const created = options.createSocket(options.endpoint, {
        open() {
          queueMicrotask(() => {
            if (disposed || current !== generation) { return }
            try {
              send({ type: 'hello', protocol: SQLITE_DEVTOOLS_PROTOCOL, token: options.token, runtime: options.runtime, databases: databases() })
              authTimer = setTimeout(disconnect, 5000, current)
            }
            catch { disconnect(current) }
          })
        },
        message: (text) => { void receive(text, current) },
        close: () => disconnect(current),
        error: () => disconnect(current),
      })
      // A host adapter may report an immediate connection failure while
      // createSocket is still evaluating. In that case disconnect() has
      // already advanced the generation; do not retain the stale socket or
      // let a later reconnect race with it.
      if (disposed || current !== generation) {
        try { created.close() }
        catch { /* The adapter may have already closed the socket. */ }
        return
      }
      socket = created
    }
    catch { disconnect(current) }
  }

  connect()
  return {
    refresh() {
      if (!disposed && sessionId) {
        try { send({ type: 'databases', sessionId, databases: databases() }) }
        catch { disconnect(generation) }
      }
    },
    close() {
      if (disposed) { return }
      disposed = true
      clearTimeout(reconnectTimer)
      clearTimeout(authTimer)
      disconnect(generation)
    },
  }
}

export { createWeappSocketFactory, createWebSocketFactory } from './socket'
export type { SqliteDevtoolsSocket, SqliteDevtoolsSocketFactory, SqliteDevtoolsSocketHandlers, SqliteDevtoolsWeappSocketApi, SqliteDevtoolsWeappSocketTask, SqliteDevtoolsWebSocket } from './socket'

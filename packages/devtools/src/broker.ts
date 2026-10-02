import type { Server } from 'node:http'
import type { SqliteDevtoolsInvocation, SqliteDevtoolsResult, SqliteDevtoolsRuntimeDescriptor } from './protocol'
import { Buffer } from 'node:buffer'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import {
  decodeSqliteDevtoolsValue,
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

const RUNTIME_PATH = '/__weapp-sqlite/runtime'
interface Pending {
  readonly resolve: (result: SqliteDevtoolsResult) => void
  readonly timer: ReturnType<typeof setTimeout>
}
interface Peer {
  readonly socket: WebSocket
  readonly descriptor: SqliteDevtoolsRuntimeDescriptor
  readonly pending: Map<string, Pending>
}

export interface SqliteDevtoolsBrokerOptions {
  readonly allowWrite?: boolean
  readonly requestTimeoutMs?: number
}

function errorResult(code: string, message: string): SqliteDevtoolsResult {
  return { ok: false, error: { code, message } }
}

function validOrigin(origin: string | undefined) {
  if (!origin) { return true }
  try {
    const url = new URL(origin)
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || (url.protocol === 'https:' && url.hostname === 'servicewechat.com')
  }
  catch { return false }
}

/** broker 只路由到拥有数据库的 runtime，不会在 Node 端打开数据库副本。 */
export function createSqliteDevtoolsBroker(options: SqliteDevtoolsBrokerOptions = {}) {
  const token = randomBytes(32).toString('hex')
  const peers = new Map<string, Peer>()
  const sockets = new Set<WebSocket>()
  const listeners = new Set<() => void>()
  const server = new WebSocketServer({ noServer: true, maxPayload: SQLITE_DEVTOOLS_MAX_MESSAGE_BYTES, perMessageDeflate: false })
  let detach: (() => void) | undefined
  let closed = false

  function changed() {
    for (const listener of listeners) { listener() }
  }

  function remove(peer: Peer) {
    for (const pending of peer.pending.values()) {
      clearTimeout(pending.timer)
      pending.resolve(errorResult('SQLITE_DEVTOOLS_DISCONNECTED', 'Runtime disconnected. The operation was not retried; its outcome may be unknown.'))
    }
    peer.pending.clear()
    if (peers.get(peer.descriptor.id) === peer) {
      peers.delete(peer.descriptor.id)
      changed()
    }
  }

  server.on('connection', (socket) => {
    if (closed || sockets.size >= 32) { socket.close(1008, 'Runtime capacity reached'); return }
    sockets.add(socket)
    let peer: Peer | undefined
    const authTimer = setTimeout(() => socket.close(1008, 'Authentication timed out'), 5000)
    socket.on('error', () => { socket.terminate() })
    socket.on('close', () => {
      clearTimeout(authTimer)
      sockets.delete(socket)
      if (peer) { remove(peer) }
    })
    socket.on('message', (bytes, binary) => {
      try {
        // ws.RawData also permits fragmented Buffer[] frames. Normalize the
        // payload once so size checks and JSON decoding use the same bytes.
        const frame = Array.isArray(bytes)
          ? Buffer.concat(bytes)
          : bytes instanceof ArrayBuffer
            ? Buffer.from(bytes)
            : bytes
        if (binary || (!peer && frame.byteLength > 32768)) { throw new Error('Invalid frame') }
        const message: unknown = JSON.parse(frame.toString())
        if (!isRecord(message)) { throw new Error('Invalid frame') }
        if (!peer) {
          if (message.type !== 'hello' || message.protocol !== SQLITE_DEVTOOLS_PROTOCOL || typeof message.token !== 'string'
            || message.token.length !== token.length || !timingSafeEqual(Buffer.from(message.token), Buffer.from(token))
            || !isRecord(message.runtime) || !isIdentifier(message.runtime.id) || !isIdentifier(message.runtime.label)
            || !isIdentifier(message.runtime.platform) || !validDatabaseNames(message.databases)) {
            throw new Error('Invalid authentication')
          }
          const old = peers.get(message.runtime.id)
          if (old) { remove(old); old.socket.close(1000, 'Runtime replaced') }
          peer = {
            socket,
            descriptor: {
              id: message.runtime.id,
              label: message.runtime.label,
              platform: message.runtime.platform,
              databases: [...message.databases],
              sessionId: randomUUID(),
              connectedAt: new Date().toISOString(),
              readOnly: options.allowWrite !== true,
            },
            pending: new Map(),
          }
          clearTimeout(authTimer)
          peers.set(peer.descriptor.id, peer)
          socket.send(JSON.stringify({ type: 'ready', sessionId: peer.descriptor.sessionId, allowWrite: options.allowWrite === true }))
          changed()
          return
        }
        if (peers.get(peer.descriptor.id) !== peer || message.sessionId !== peer.descriptor.sessionId) { throw new Error('Stale runtime session') }
        if (message.type === 'databases' && validDatabaseNames(message.databases)) {
          peer = { ...peer, descriptor: { ...peer.descriptor, databases: [...message.databases] } }
          peers.set(peer.descriptor.id, peer)
          changed()
          return
        }
        if ((message.type !== 'result' && message.type !== 'release-result') || !isIdentifier(message.requestId) || !isRecord(message.result)) { throw new Error('Invalid runtime response') }
        const pending = peer.pending.get(message.requestId)
        if (!pending) { return }
        const result = message.result
        if (result.ok === true) {
          decodeSqliteDevtoolsValue(result.value)
        }
        else if (result.ok !== false || !isRecord(result.error) || !isIdentifier(result.error.code)
          || typeof result.error.message !== 'string' || result.error.message.length > 4096) {
          throw new Error('Invalid runtime response')
        }
        clearTimeout(pending.timer)
        peer.pending.delete(message.requestId)
        pending.resolve(result as unknown as SqliteDevtoolsResult)
      }
      catch { socket.close(1008, 'Invalid SQLite runtime protocol') }
    })
  })

  return {
    token,
    path: RUNTIME_PATH,
    listRuntimes(): SqliteDevtoolsRuntimeDescriptor[] {
      return [...peers.values()].map(peer => ({ ...peer.descriptor, databases: [...peer.descriptor.databases] }))
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async invoke(input: unknown): Promise<SqliteDevtoolsResult> {
      try {
        if (!isRecord(input) || !isIdentifier(input.runtimeId) || !isIdentifier(input.sessionId)
          || !isIdentifier(input.databaseName) || !isSqliteDevtoolsMethod(input.method) || input.method === 'close') {
          throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_INVALID_REQUEST', 'Unknown SQLite runtime, database, or method.')
        }
        const args = decodeSqliteDevtoolsValue(input.args)
        if (!Array.isArray(args) || args.length > 8) { throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_INVALID_REQUEST', 'SQLite arguments must be an array.') }
        const peer = peers.get(input.runtimeId)
        if (!peer || peer.descriptor.sessionId !== input.sessionId || peer.socket.readyState !== WebSocket.OPEN) {
          return errorResult('SQLITE_DEVTOOLS_DISCONNECTED', 'The selected runtime session is no longer connected.')
        }
        if (!peer.descriptor.databases.includes(input.databaseName)) {
          return errorResult('SQLITE_DEVTOOLS_DATABASE_CLOSED', 'The selected database is no longer registered.')
        }
        if (options.allowWrite !== true && isSqliteDevtoolsWriteMethod(input.method)) {
          return errorResult('SQLITE_DEVTOOLS_READ_ONLY', 'This SQLite DevTools host is read-only.')
        }
        if (peer.pending.size >= 64) { return errorResult('SQLITE_DEVTOOLS_BUSY', 'Too many pending SQLite operations.') }
        const requestId = randomUUID()
        const frame = JSON.stringify({ ...input as unknown as SqliteDevtoolsInvocation, type: 'request', requestId })
        if (Buffer.byteLength(frame) > SQLITE_DEVTOOLS_MAX_MESSAGE_BYTES) {
          return errorResult('SQLITE_DEVTOOLS_PAYLOAD_LIMIT', 'SQLite operation exceeds the message limit.')
        }
        return await new Promise<SqliteDevtoolsResult>((resolve) => {
          const timer = setTimeout(() => {
            peer.pending.delete(requestId)
            resolve(errorResult('SQLITE_DEVTOOLS_TIMEOUT', 'SQLite operation timed out. It was not retried; its outcome may be unknown.'))
          }, options.requestTimeoutMs ?? 30000)
          peer.pending.set(requestId, { resolve, timer })
          peer.socket.send(frame, (error) => {
            if (error) { remove(peer); peer.socket.terminate() }
          })
        })
      }
      catch (error) { return { ok: false, error: serializeDevtoolsError(error) } }
    },
    async releaseSession(input: unknown): Promise<SqliteDevtoolsResult> {
      try {
        if (!isRecord(input) || !isIdentifier(input.runtimeId) || !isIdentifier(input.sessionId)) {
          throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_INVALID_REQUEST', 'Unknown SQLite runtime session.')
        }
        const peer = peers.get(input.runtimeId)
        if (!peer || peer.descriptor.sessionId !== input.sessionId || peer.socket.readyState !== WebSocket.OPEN) {
          return errorResult('SQLITE_DEVTOOLS_DISCONNECTED', 'The selected runtime session is no longer connected.')
        }
        if (peer.pending.size >= 64) { return errorResult('SQLITE_DEVTOOLS_BUSY', 'Too many pending SQLite operations.') }
        const requestId = randomUUID()
        const frame = JSON.stringify({ type: 'release', sessionId: peer.descriptor.sessionId, requestId })
        if (Buffer.byteLength(frame) > SQLITE_DEVTOOLS_MAX_MESSAGE_BYTES) {
          return errorResult('SQLITE_DEVTOOLS_PAYLOAD_LIMIT', 'SQLite session release exceeds the message limit.')
        }
        return await new Promise<SqliteDevtoolsResult>((resolve) => {
          const timer = setTimeout(() => {
            peer.pending.delete(requestId)
            resolve(errorResult('SQLITE_DEVTOOLS_TIMEOUT', 'SQLite debug session release timed out.'))
          }, options.requestTimeoutMs ?? 30000)
          peer.pending.set(requestId, { resolve, timer })
          peer.socket.send(frame, (error) => {
            if (error) { remove(peer); peer.socket.terminate() }
          })
        })
      }
      catch (error) { return { ok: false, error: serializeDevtoolsError(error) } }
    },
    attach(httpServer: Server) {
      if (closed || detach) { throw new Error('SQLite runtime broker is already attached or closed.') }
      const upgrade: Parameters<Server['on']>[1] = (request, socket, head) => {
        if (request.url?.split('?')[0] !== RUNTIME_PATH) { return }
        if (closed || !validOrigin(request.headers.origin)) { socket.destroy(); return }
        server.handleUpgrade(request, socket, head, (client) => { server.emit('connection', client, request) })
      }
      httpServer.on('upgrade', upgrade)
      detach = () => { httpServer.off('upgrade', upgrade) }
    },
    async close() {
      if (closed) { return }
      closed = true
      detach?.()
      for (const peer of peers.values()) { remove(peer) }
      for (const socket of sockets) { socket.terminate() }
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
      listeners.clear()
    },
  }
}

export type SqliteDevtoolsBroker = ReturnType<typeof createSqliteDevtoolsBroker>

import type { SqliteDebugController } from '@weapp-sqlite/debug'
import type { SqliteDevtoolsInvocation, SqliteDevtoolsRuntimeDescriptor } from './protocol'
import { authenticateWithUrlOtp, getDevframeRpcClient } from 'devframe/client'
import { decodeSqliteDevtoolsValue, encodeSqliteDevtoolsValue, SQLITE_DEVTOOLS_SCOPE, SqliteDevtoolsError } from './protocol'

type SqliteDevtoolsRequestMethod = Exclude<keyof SqliteDebugController, 'close'>

export interface SqliteDevtoolsClient {
  listRuntimes: () => Promise<readonly SqliteDevtoolsRuntimeDescriptor[]>
  request: <K extends SqliteDevtoolsRequestMethod>(runtimeId: string, databaseName: string, method: K, args: Parameters<SqliteDebugController[K]>) => Promise<Awaited<ReturnType<SqliteDebugController[K]>>>
  subscribe: (listener: (runtimes: readonly SqliteDevtoolsRuntimeDescriptor[]) => void) => () => void
  subscribeStatus: (listener: (status: 'connecting' | 'connected' | 'disconnected') => void) => () => void
  dispose: () => Promise<void>
}

/** Connects the panel to the host Devframe RPC namespace. */
export async function connectDevtoolsClient(): Promise<SqliteDevtoolsClient> {
  const rpc = await getDevframeRpcClient({ otpParam: false })
  // A Vite DevTools host can pre-authorize the scoped client and provide no
  // OTP in the panel URL. Preserve that trusted state; only perform the OTP
  // exchange when the host still needs authentication.
  const authenticated = rpc.isTrusted || await authenticateWithUrlOtp(rpc).catch(() => false)
  if (!authenticated || !rpc.isTrusted) {
    rpc.close?.()
    throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_UNAUTHORIZED', 'Devframe did not authorize the SQLite panel.')
  }
  const scoped = rpc.scope(SQLITE_DEVTOOLS_SCOPE).rpc as any
  const runtimeListeners = new Set<(runtimes: readonly SqliteDevtoolsRuntimeDescriptor[]) => void>()
  const statusListeners = new Set<(status: 'connecting' | 'connected' | 'disconnected') => void>()
  let runtimes: readonly SqliteDevtoolsRuntimeDescriptor[] = []
  let disposing: Promise<void> | undefined
  const ownerId = `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const status = () => {
    const next = rpc.status === 'connected' ? 'connected' : rpc.status === 'connecting' ? 'connecting' : 'disconnected'
    for (const listener of statusListeners) {
      listener(next)
    }
  }
  const event = {
    name: 'state-updated',
    type: 'event',
    jsonSerializable: true,
    handler: (nextRuntimes: readonly SqliteDevtoolsRuntimeDescriptor[]) => {
      // Keep session ids in sync so requests cannot target a stale runtime.
      runtimes = nextRuntimes
      for (const listener of runtimeListeners) {
        listener(nextRuntimes)
      }
    },
  }
  scoped.register(event)
  rpc.events.on('connection:status', status)
  status()
  return {
    async listRuntimes() {
      runtimes = await scoped.call('list-runtimes', ownerId) as readonly SqliteDevtoolsRuntimeDescriptor[]
      return runtimes
    },
    request: (async (runtimeId, databaseName, method, args) => {
      const runtime = runtimes.find(item => item.id === runtimeId)
      if (!runtime || !runtime.databases.includes(databaseName)) {
        throw new SqliteDevtoolsError('SQLITE_DEVTOOLS_DATABASE_CLOSED', 'The selected SQLite runtime or database is unavailable.')
      }
      const invocation: SqliteDevtoolsInvocation = { runtimeId, sessionId: runtime.sessionId, databaseName, method: method as SqliteDevtoolsInvocation['method'], args: encodeSqliteDevtoolsValue(args) }
      const result = await scoped.call('invoke', invocation)
      if (!result.ok) {
        throw new SqliteDevtoolsError(result.error.code, result.error.message)
      }
      return decodeSqliteDevtoolsValue(result.value) as Awaited<ReturnType<SqliteDebugController[typeof method]>>
    }) as SqliteDevtoolsClient['request'],
    subscribe(listener: (runtimes: readonly SqliteDevtoolsRuntimeDescriptor[]) => void) {
      runtimeListeners.add(listener)
      return () => runtimeListeners.delete(listener)
    },
    subscribeStatus(listener: (status: 'connecting' | 'connected' | 'disconnected') => void) {
      statusListeners.add(listener)
      status()
      return () => statusListeners.delete(listener)
    },
    dispose() {
      return disposing ??= (async () => {
        // Release debug controllers before closing the Devframe transport. A
        // runtime keeps its application-owned database handles alive.
        await Promise.allSettled(runtimes.map(runtime => Promise.resolve().then(() => scoped.call('release-session', {
          runtimeId: runtime.id,
          sessionId: runtime.sessionId,
          ownerId,
        }))))
        scoped.unregister?.()
        rpc.close?.()
      })()
    },
  } as unknown as SqliteDevtoolsClient
}

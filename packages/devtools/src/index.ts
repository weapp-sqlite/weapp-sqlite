import type { Server } from 'node:http'
import type { SqliteDevtoolsBrokerOptions } from './broker'
import type { SqliteDevtoolsInvocation, SqliteDevtoolsResult, SqliteDevtoolsRuntimeDescriptor } from './protocol'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { DevTools } from '@vitejs/devtools'
import { createPluginFromDevframe } from '@vitejs/devtools-kit/node'
import { defineDevframe, defineRpcFunction } from 'devframe'
import { buildOtpAuthUrl, refreshTempAuthCode } from 'devframe/node/auth'
import { createServer } from 'vite'
import { createSqliteDevtoolsBroker } from './broker'
import { SQLITE_DEVTOOLS_SCOPE } from './protocol'

declare module 'devframe' {
  interface DevframeRpcServerFunctions {
    'weapp-sqlite:list-runtimes': () => SqliteDevtoolsRuntimeDescriptor[]
    'weapp-sqlite:invoke': (input: SqliteDevtoolsInvocation) => Promise<SqliteDevtoolsResult>
    'weapp-sqlite:release-session': (input: { runtimeId: string, sessionId: string }) => Promise<SqliteDevtoolsResult>
  }
  interface DevframeRpcClientFunctions {
    'weapp-sqlite:state-updated': (runtimes: SqliteDevtoolsRuntimeDescriptor[]) => void
  }
}

export interface CreateSqliteDevtoolsDevframeOptions extends SqliteDevtoolsBrokerOptions {
  readonly clientAssets?: string
}

export function createSqliteDevtoolsDevframe(options: CreateSqliteDevtoolsDevframeOptions = {}) {
  const broker = createSqliteDevtoolsBroker(options)
  let unsubscribe: (() => void) | undefined
  let disposing: Promise<void> | undefined
  const definition = defineDevframe({
    id: SQLITE_DEVTOOLS_SCOPE,
    name: 'SQLite',
    version: '0.1.0',
    packageName: '@weapp-sqlite/devtools',
    importMetaUrl: import.meta.url,
    homepage: 'https://github.com/weapp-sqlite/weapp-sqlite',
    description: '查看与调试 Web 和小程序运行时中的 SQLite 数据库。',
    icon: 'ph:database-duotone',
    capabilities: { dev: true, build: false },
    clientAssets: options.clientAssets ?? fileURLToPath(new URL('./client/', import.meta.url)),
    async setup(ctx) {
      const scope = ctx.scope(SQLITE_DEVTOOLS_SCOPE)
      scope.rpc.register(defineRpcFunction({ name: 'list-runtimes', type: 'query', jsonSerializable: true, handler: broker.listRuntimes }))
      scope.rpc.register(defineRpcFunction({ name: 'invoke', type: 'action', jsonSerializable: true, handler: broker.invoke }))
      scope.rpc.register(defineRpcFunction({ name: 'release-session', type: 'action', jsonSerializable: true, handler: broker.releaseSession }))
      unsubscribe?.()
      unsubscribe = broker.subscribe(() => {
        void scope.rpc.broadcast({ method: 'state-updated', args: [broker.listRuntimes()], event: true }).catch(() => {})
      })
    },
  })
  return {
    definition,
    broker,
    dispose() {
      return disposing ??= (async () => {
        unsubscribe?.()
        unsubscribe = undefined
        await broker.close()
      })()
    },
  }
}

export type SqliteDevtoolsDevframe = ReturnType<typeof createSqliteDevtoolsDevframe>

/** 认证与 Origin 策略由 Vite DevTools 宿主持有，runtime broker 另用专用凭证。 */
/** Vite-compatible subset; keeps the public declaration independent of Vite's server internals. */
export interface SqliteDevtoolsPlugin {
  readonly name: string
  readonly apply: 'serve'
  readonly configureServer: (server: { readonly httpServer?: unknown }) => void
  readonly closeServer: () => Promise<void>
  readonly closeBundle: () => Promise<void>
}

export function createSqliteDevtoolsPlugin(controller: SqliteDevtoolsDevframe): SqliteDevtoolsPlugin {
  const plugin = createPluginFromDevframe(controller.definition)
  return {
    ...plugin,
    apply: 'serve',
    configureServer(server) {
      if (!server.httpServer) { throw new Error('SQLite DevTools requires an HTTP server for its runtime bridge.') }
      controller.broker.attach(server.httpServer as Server)
      const httpServer = server.httpServer as { once: (event: string, listener: () => void) => void }
      httpServer.once('close', () => { void controller.dispose() })
    },
    async closeServer() { await controller.dispose() },
    async closeBundle() { await controller.dispose() },
  }
}

export interface StartSqliteDevtoolsServerOptions extends CreateSqliteDevtoolsDevframeOptions {
  readonly cwd?: string
  readonly port?: number
}

export interface SqliteDevtoolsServer {
  readonly url: string
  readonly runtimeEndpoint: string
  readonly runtimeToken: string
  close: () => Promise<void>
}

/** 创建独立开发宿主；调用方负责其 watcher 与退出生命周期。 */
export async function startSqliteDevtoolsServer(options: StartSqliteDevtoolsServerOptions = {}): Promise<SqliteDevtoolsServer> {
  const controller = createSqliteDevtoolsDevframe(options)
  const assets = controller.definition.clientAssets
  if (typeof assets !== 'string' || !existsSync(path.join(assets, 'index.html'))) {
    await controller.dispose()
    throw new Error('SQLite DevTools client is missing. Build @weapp-sqlite/devtools first.')
  }
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  try {
    const devtoolsPlugins = await DevTools({ builtinDevTools: false, clientAuth: true, allowedOrigins: [], mcp: false } as never)
    server = await createServer({
      configFile: false,
      root: options.cwd ?? process.cwd(),
      publicDir: false,
      appType: 'custom',
      clearScreen: false,
      logLevel: 'silent',
      plugins: [
        ...devtoolsPlugins,
        createSqliteDevtoolsPlugin(controller),
      ],
      server: { host: '127.0.0.1', port: options.port ?? 0, strictPort: options.port !== undefined && options.port !== 0, watch: { ignored: ['**/*'] } },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') { throw new Error('SQLite DevTools could not resolve its listening port.') }
    const origin = `http://127.0.0.1:${address.port}`
    let closing: Promise<void> | undefined
    const activeServer = server
    return {
      url: buildOtpAuthUrl(`${origin}/__weapp-sqlite/`, refreshTempAuthCode()),
      runtimeEndpoint: `ws://127.0.0.1:${address.port}${controller.broker.path}`,
      runtimeToken: controller.broker.token,
      close() {
        return closing ??= controller.dispose().finally(() => activeServer.close())
      },
    }
  }
  catch (error) {
    await controller.dispose()
    await server?.close()
    throw error
  }
}

export type { SqliteDevtoolsClient } from './client'
export { connectDevtoolsClient } from './client'
export type { SqliteDevtoolsInvocation, SqliteDevtoolsMethod, SqliteDevtoolsReleaseSession, SqliteDevtoolsRuntimeDescriptor } from './protocol'

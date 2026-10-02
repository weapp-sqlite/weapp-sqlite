import type { SqliteDebugController } from '@weapp-sqlite/debug'
import type { SqliteDebugWorkspaceOptions, SqliteRuntimeTarget } from './types'
import { connectSqliteDevtoolsRuntime, createWeappSocketFactory, createWebSocketFactory } from '@weapp-sqlite/devtools/runtime'
import { createSqliteDebugController, listSqliteRuntimeDatabases, normalizeSqliteDebugWorkspaceOptions } from './debug'

declare const wx: Parameters<typeof createWeappSocketFactory>[0] | undefined

export interface InitializeSqliteDevtoolsOptions {
  readonly endpoint: string
  readonly token: string
  readonly target: SqliteRuntimeTarget
  readonly workspace: SqliteDebugWorkspaceOptions
}

/** 仅由开发虚拟模块引入，连接正在使用的数据库并在断线时释放调试会话。 */
export function initializeSqliteDevtools(options: InitializeSqliteDevtoolsOptions) {
  const configured = normalizeSqliteDebugWorkspaceOptions(options.workspace).filter(item => item.enabled !== false)
  const controllers = new Map<string, { generation: number | undefined, controller: SqliteDebugController }>()
  function releaseControllers() {
    for (const { controller } of controllers.values()) {
      void controller.close().catch(() => undefined)
    }
    controllers.clear()
  }
  function listDatabases() {
    if (options.workspace.enabled === false) {
      return []
    }
    return Array.from(new Set([
      ...configured.map(item => item.databaseName),
      ...listSqliteRuntimeDatabases().map(item => item.databaseName),
    ]))
  }
  const createSocket = options.target === 'web' && typeof WebSocket !== 'undefined'
    ? createWebSocketFactory(WebSocket)
    : options.target === 'weapp' && typeof wx !== 'undefined'
      ? createWeappSocketFactory(wx)
      : undefined
  if (!createSocket || options.workspace.enabled === false) {
    return { refresh() {}, close() {} }
  }
  const runtimeId = `${options.target}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const connection = connectSqliteDevtoolsRuntime({
    endpoint: options.endpoint,
    token: options.token,
    runtime: { id: runtimeId, label: options.target === 'weapp' ? '微信开发工具' : 'Web 应用', platform: options.target },
    createSocket,
    listDatabases,
    getController(databaseName) {
      if (!listDatabases().includes(databaseName)) {
        throw new Error(`SQLite database "${databaseName}" is not registered in this runtime.`)
      }
      const generation = listSqliteRuntimeDatabases().find(item => item.databaseName === databaseName)?.generation
      const cached = controllers.get(databaseName)
      if (cached && (cached.generation === undefined || cached.generation === generation)) {
        cached.generation = generation
        return cached.controller
      }
      if (cached) {
        void cached.controller.close().catch(() => undefined)
      }
      const database = configured.find(item => item.databaseName === databaseName)
      const controller = createSqliteDebugController({ ...database, databaseName, enabled: true })
      controllers.set(databaseName, { generation, controller })
      return controller
    },
    onDisconnect: releaseControllers,
  })
  return {
    refresh: () => connection.refresh(),
    close() {
      connection.close()
      releaseControllers()
    },
  }
}

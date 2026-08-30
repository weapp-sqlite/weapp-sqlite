import type { SqliteDebugRuntimeControllerOptions } from './types'
import { createSqliteDebugController as createController } from '@weapp-sqlite/debug'
import { defaultSqliteRuntimeAdapter } from './default-adapter'
import { openSqliteWithAdapter } from './open'

export type { SqliteDebugRuntimeControllerOptions } from './types'

export function createSqliteDebugController(options: SqliteDebugRuntimeControllerOptions) {
  const adapter = options.adapter ?? defaultSqliteRuntimeAdapter
  const runtime: Record<string, unknown> = { target: adapter.target, engine: adapter.kind }
  void adapter.getRuntimeInfo().then(info => Object.assign(runtime, info), () => undefined)
  return createController({
    databaseName: options.databaseName,
    openDatabase: () => openSqliteWithAdapter({
      name: options.databaseName,
      ...(options.migrations === undefined ? {} : { migrations: options.migrations }),
      adapter,
    }, adapter),
    storage: {
      load: name => adapter.loadSnapshot(name),
      save: (name, bytes) => adapter.saveSnapshot(name, bytes),
      remove: name => adapter.remove(name),
    },
    enabled: options.enabled === true,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    runtime,
  })
}

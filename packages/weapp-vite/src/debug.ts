import type { SqliteDebugController, SqliteDebugTableFormat } from '@weapp-sqlite/debug'
import type { SqliteDebugRuntimeControllerOptions, SqliteDebugWorkspaceOptions, SqliteRuntimeInfo } from './types'
import { createSqliteDebugController as createController } from '@weapp-sqlite/debug'
import { defaultSqliteRuntimeAdapter } from './default-adapter'
import { SqliteRuntimeError } from './errors'
import { openSqliteWithAdapter } from './open'

export type { SqliteDebugRuntimeControllerOptions, SqliteDebugWorkspaceOptions } from './types'

export interface SqliteDebugWorkspace {
  readonly controller: SqliteDebugController
  readonly runtime: SqliteRuntimeInfo
  saveDatabase: () => Promise<{ readonly method: string, readonly fileName: string }>
  saveTable: (tableName: string, format: SqliteDebugTableFormat) => Promise<{ readonly method: string, readonly fileName: string }>
  chooseFile: (options?: { readonly extensions?: readonly string[], readonly maxBytes?: number }) => Promise<{ readonly fileName: string, readonly mimeType: string, readonly bytes: Uint8Array }>
}

export function defineSqliteDebugWorkspace<T extends SqliteDebugWorkspaceOptions>(options: T): T {
  return options
}

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

export async function createSqliteDebugWorkspace(options: SqliteDebugWorkspaceOptions): Promise<SqliteDebugWorkspace> {
  const adapter = options.adapter ?? defaultSqliteRuntimeAdapter
  const controller = createSqliteDebugController({ ...options, adapter, enabled: options.enabled !== false })
  const runtime = await adapter.getRuntimeInfo()

  function files() {
    if (!adapter.debugFiles) {
      throw new SqliteRuntimeError('SQLITE_RUNTIME_UNSUPPORTED', adapter.target, `Debug file management is unsupported on the ${adapter.target} runtime.`, {
        capability: 'file-delivery',
        hostCode: 'SQLITE_DEBUG_FILE_UNSUPPORTED',
      })
    }
    return adapter.debugFiles
  }

  return {
    controller,
    runtime,
    async saveDatabase() {
      const snapshot = await controller.exportDatabase()
      const timestamp = snapshot.metadata.exportedAt.replaceAll(/[:.]/g, '-')
      return files().save({
        fileName: `${snapshot.metadata.databaseName}-${timestamp}.sqlite`,
        mimeType: 'application/vnd.sqlite3',
        bytes: snapshot.bytes,
      })
    },
    async saveTable(tableName, format) {
      const artifact = await controller.exportTable(tableName, { format })
      return files().save(artifact)
    },
    chooseFile: chooseOptions => files().choose(chooseOptions),
  }
}

import type { SqliteDebugController, SqliteDebugTableFormat } from '@weapp-sqlite/debug'
import type { SqliteDebugRuntimeControllerOptions, SqliteDebugWorkspaceOptions, SqliteRuntimeInfo } from './types'
import { createSqliteDebugController as createController } from '@weapp-sqlite/debug'
import { defaultSqliteRuntimeAdapter } from './default-adapter'
import { SqliteRuntimeError } from './errors'
import { createSqliteDebugSessionWithAdapter, getSqliteRuntimeDatabaseOptions } from './open'

export { listSqliteRuntimeDatabases } from './open'

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
  const adapter = options.adapter ?? getSqliteRuntimeDatabaseOptions(options.databaseName)?.adapter ?? defaultSqliteRuntimeAdapter
  const runtime: Record<string, unknown> = { target: adapter.target, engine: adapter.kind }
  void adapter.getRuntimeInfo().then(info => Object.assign(runtime, info), () => undefined)
  return createController({
    databaseName: options.databaseName,
    session: createSqliteDebugSessionWithAdapter({
      name: options.databaseName,
      ...(options.migrations === undefined ? {} : { migrations: options.migrations }),
      adapter,
    }, adapter),
    enabled: options.enabled === true,
    ...(options.migrations === undefined ? {} : { migrations: options.migrations }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    runtime,
  })
}

export function normalizeSqliteDebugWorkspaceOptions(options: SqliteDebugWorkspaceOptions): readonly SqliteDebugRuntimeControllerOptions[] {
  const databases = 'databases' in options ? options.databases : [options]
  if (databases.length === 0) {
    throw new TypeError('A SQLite debug workspace requires at least one database.')
  }
  const names = new Set<string>()
  for (const database of databases) {
    if (!database.databaseName || names.has(database.databaseName)) {
      throw new TypeError('SQLite debug database names must be nonempty and unique.')
    }
    names.add(database.databaseName)
  }
  if ('defaultDatabase' in options && options.defaultDatabase !== undefined && !names.has(options.defaultDatabase)) {
    throw new TypeError('The default SQLite debug database must be configured in databases.')
  }
  return databases.map(database => ({ ...database, enabled: options.enabled === false ? false : database.enabled !== false }))
}

export async function createSqliteDebugWorkspace(options: SqliteDebugWorkspaceOptions): Promise<SqliteDebugWorkspace> {
  const databases = normalizeSqliteDebugWorkspaceOptions(options)
  const selected = ('defaultDatabase' in options && options.defaultDatabase !== undefined
    ? databases.find(database => database.databaseName === options.defaultDatabase)
    : databases[0]) as SqliteDebugRuntimeControllerOptions
  const adapter = selected.adapter ?? getSqliteRuntimeDatabaseOptions(selected.databaseName)?.adapter ?? defaultSqliteRuntimeAdapter
  const controller = createSqliteDebugController({ ...selected, adapter, enabled: selected.enabled !== false })
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

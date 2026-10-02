import type { OpenSqliteOptions, RemoveSqliteOptions, SqliteRuntimeAdapter, SqliteRuntimeInfo, SqliteRuntimeTarget } from './types'
import { connectSqliteDevtools } from 'virtual:weapp-sqlite-devtools'
import { defaultSqliteRuntimeAdapter } from './default-adapter'
import { openSqliteWithAdapter, removeSqliteWithAdapter } from './open'

connectSqliteDevtools()

export { SqliteRuntimeError } from './errors'
export type { SqliteRuntimeErrorCode } from './errors'
export type {
  OpenSqliteOptions,
  RemoveSqliteOptions,
  SqliteRuntimeAdapter,
  SqliteRuntimeCapabilityReport,
  SqliteRuntimeInfo,
  SqliteRuntimeTarget,
} from './types'
export { execMany, getMigrationStatus, SqlitePersistenceError } from '@weapp-sqlite/core'
export type { SqliteAppliedMigration, SqliteMigrationConflict, SqliteMigrationInfo, SqliteMigrationStatus } from '@weapp-sqlite/core'

export async function openSqlite(options: OpenSqliteOptions) {
  const database = await openSqliteWithAdapter(options, defaultSqliteRuntimeAdapter)
  connectSqliteDevtools()
  return database
}

export async function removeSqlite(options: RemoveSqliteOptions) {
  await removeSqliteWithAdapter(options, defaultSqliteRuntimeAdapter)
  connectSqliteDevtools()
}

export function getSqliteTarget(): SqliteRuntimeTarget {
  return defaultSqliteRuntimeAdapter.target
}

export function getSqliteRuntimeInfo(adapter?: SqliteRuntimeAdapter): Promise<SqliteRuntimeInfo> {
  return (adapter ?? defaultSqliteRuntimeAdapter).getRuntimeInfo()
}

export function getSqliteDatabasePath(name: string, adapter?: SqliteRuntimeAdapter): string | undefined {
  return (adapter ?? defaultSqliteRuntimeAdapter).getDatabasePath?.(name)
}

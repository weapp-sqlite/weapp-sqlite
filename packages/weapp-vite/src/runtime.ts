import type { OpenSqliteOptions, RemoveSqliteOptions, SqliteRuntimeAdapter, SqliteRuntimeInfo, SqliteRuntimeTarget } from './types'
import { defaultSqliteRuntimeAdapter } from './default-adapter'
import { openSqliteWithAdapter, removeSqliteWithAdapter } from './open'

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

export function openSqlite(options: OpenSqliteOptions) {
  return openSqliteWithAdapter(options, defaultSqliteRuntimeAdapter)
}

export function removeSqlite(options: RemoveSqliteOptions) {
  return removeSqliteWithAdapter(options, defaultSqliteRuntimeAdapter)
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

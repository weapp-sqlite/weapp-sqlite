import type { SqliteDatabase, SqliteParameters, SqliteQueryResult } from '@weapp-sqlite/core'
import type { SqliteWasmStorage } from '@weapp-sqlite/wasm'

export interface SqliteDebugStorage extends SqliteWasmStorage {
  remove: (name: string) => Promise<void>
}

export interface SqliteDebugLimits {
  readonly maxRows?: number
  readonly maxResultBytes?: number
  readonly maxImportBytes?: number
}

export interface SqliteDebugRuntimeInfo {
  readonly platform?: string
  readonly system?: string
  readonly clientVersion?: string
  readonly sdkVersion?: string
  readonly [key: string]: unknown
}

export interface SqliteDebugControllerOptions {
  readonly databaseName: string
  readonly openDatabase: () => Promise<SqliteDatabase>
  readonly storage: SqliteDebugStorage
  readonly enabled?: boolean
  readonly limits?: SqliteDebugLimits
  readonly runtime?: SqliteDebugRuntimeInfo
}

export interface SqliteDebugTable {
  readonly name: string
  readonly type: string
  readonly sql: string | null
}

export interface SqliteDebugColumn {
  readonly name: string
  readonly type: string
  readonly notNull: boolean
  readonly primaryKey: boolean
  readonly defaultValue: unknown
}

export interface SqliteDebugPage {
  readonly columns: readonly string[]
  readonly rows: readonly Record<string, unknown>[]
  readonly total: number
  readonly limit: number
  readonly offset: number
}

export interface SqliteDebugQueryResult extends SqliteQueryResult {
  readonly elapsedMs: number
}

export interface SqliteDebugExecutionResult {
  readonly changes: number
  readonly lastInsertRowid?: number | bigint
  readonly elapsedMs: number
}

export interface SqliteDebugMigration {
  readonly version: number
  readonly name: string
  readonly appliedAt: string
}

export interface SqliteDebugMigrationStatus {
  readonly tablePresent: boolean
  readonly versions: readonly SqliteDebugMigration[]
}

export interface SqliteDebugSnapshotMetadata {
  readonly databaseName: string
  readonly byteLength: number
  readonly sha256: string
  readonly migrationVersions: readonly number[]
  readonly exportedAt: string
  readonly runtime: SqliteDebugRuntimeInfo
}

export interface SqliteDebugSnapshot {
  readonly bytes: Uint8Array
  readonly metadata: SqliteDebugSnapshotMetadata
}

export interface SqliteDebugController {
  listTables: () => Promise<readonly SqliteDebugTable[]>
  describeTable: (tableName: string) => Promise<readonly SqliteDebugColumn[]>
  readTable: (tableName: string, options?: { readonly limit?: number, readonly offset?: number }) => Promise<SqliteDebugPage>
  query: (sql: string, parameters?: SqliteParameters) => Promise<SqliteDebugQueryResult>
  execute: (sql: string, parameters?: SqliteParameters, options?: { readonly allowWrite?: boolean }) => Promise<SqliteDebugExecutionResult>
  getMigrationStatus: () => Promise<SqliteDebugMigrationStatus>
  exportDatabase: () => Promise<SqliteDebugSnapshot>
  importDatabase: (bytes: Uint8Array | ArrayBuffer, options: { readonly replace: true }) => Promise<SqliteDebugSnapshotMetadata>
  resetDatabase: () => Promise<void>
  close: () => Promise<void>
}

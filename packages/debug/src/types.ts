import type { SqliteDatabase, SqliteParameters, SqliteQueryResult, SqliteScalar } from '@weapp-sqlite/core'
import type { SqliteWasmStorage } from '@weapp-sqlite/wasm'

export interface SqliteDebugStorage extends SqliteWasmStorage {
  remove: (name: string) => Promise<void>
}

export interface SqliteDebugLimits {
  readonly maxRows?: number
  readonly maxResultBytes?: number
  readonly maxImportBytes?: number
  readonly maxImportRows?: number
  readonly maxExportBytes?: number
  readonly maxExportRows?: number
  readonly maxUndoBytes?: number
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

export type SqliteDebugFilterOperator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'startsWith' | 'isNull' | 'isNotNull'

export interface SqliteDebugFilter {
  readonly column: string
  readonly operator: SqliteDebugFilterOperator
  readonly value?: SqliteScalar
}

export interface SqliteDebugOrder {
  readonly column: string
  readonly direction: 'asc' | 'desc'
}

export interface SqliteDebugReadOptions {
  readonly limit?: number
  readonly offset?: number
  readonly filters?: readonly SqliteDebugFilter[]
  readonly orderBy?: readonly SqliteDebugOrder[]
  readonly search?: string
}

export type SqliteDebugRowLocator
  = | { readonly kind: 'primary-key', readonly values: Readonly<Record<string, SqliteScalar>> }
    | { readonly kind: 'rowid', readonly value: number | bigint }

export interface SqliteDebugPage {
  readonly columns: readonly string[]
  readonly rows: readonly Record<string, unknown>[]
  readonly rowLocators: readonly SqliteDebugRowLocator[]
  readonly total: number
  readonly limit: number
  readonly offset: number
}

export interface SqliteDebugTableCapabilities {
  readonly tableName: string
  readonly objectType: 'table' | 'view'
  readonly readable: boolean
  readonly writable: boolean
  readonly locator: 'primary-key' | 'rowid' | 'none'
  readonly primaryKey: readonly string[]
  readonly supportsRenameColumn: boolean
  readonly supportsDropColumn: boolean
  readonly reason?: string
}

export interface SqliteDebugIndexColumn {
  readonly name: string
  readonly direction: 'asc' | 'desc'
}

export interface SqliteDebugIndex {
  readonly name: string
  readonly unique: boolean
  readonly origin: string
  readonly partial: boolean
  readonly columns: readonly SqliteDebugIndexColumn[]
  readonly editable: boolean
}

export interface SqliteDebugQueryResult extends SqliteQueryResult {
  readonly elapsedMs: number
}

export interface SqliteDebugExecutionResult {
  readonly changes: number
  readonly lastInsertRowid?: number | bigint
  readonly elapsedMs: number
}

export interface SqliteDebugWriteOptions {
  readonly allowWrite: true
}

export interface SqliteDebugDestructiveOptions extends SqliteDebugWriteOptions {
  readonly confirmTable: string
}

export interface SqliteDebugColumnDefinition {
  readonly name: string
  readonly type: 'INTEGER' | 'REAL' | 'TEXT' | 'BLOB' | 'NUMERIC'
  readonly primaryKey?: boolean
  readonly notNull?: boolean
  readonly unique?: boolean
  readonly defaultExpression?: 'NULL' | 'CURRENT_TIME' | 'CURRENT_DATE' | 'CURRENT_TIMESTAMP'
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

export type SqliteDebugTableFormat = 'csv' | 'json'

export interface SqliteDebugTableArtifact {
  readonly fileName: string
  readonly mimeType: string
  readonly bytes: Uint8Array
  readonly tableName: string
  readonly format: SqliteDebugTableFormat
  readonly rowCount: number
  readonly byteLength: number
}

export interface SqliteDebugTableImportSource {
  readonly format: SqliteDebugTableFormat
  readonly bytes: Uint8Array | ArrayBuffer | string
  readonly fileName?: string
}

export interface SqliteDebugImportColumn {
  readonly source: string
  readonly target: string
  readonly inferredType: SqliteDebugColumnDefinition['type']
}

export interface SqliteDebugImportPreview {
  readonly format: SqliteDebugTableFormat
  readonly sourceColumns: readonly string[]
  readonly suggestedColumns: readonly SqliteDebugImportColumn[]
  readonly sampleRows: readonly Record<string, unknown>[]
  readonly totalRows: number
}

export interface SqliteDebugImportMapping {
  readonly source: string
  readonly target: string
  readonly type?: SqliteDebugColumnDefinition['type']
}

export interface SqliteDebugTableImportOptions extends SqliteDebugWriteOptions {
  readonly tableName: string
  readonly mode: 'create' | 'append' | 'replace'
  readonly mappings?: readonly SqliteDebugImportMapping[]
  readonly confirmTable?: string
}

export interface SqliteDebugTableImportResult {
  readonly tableName: string
  readonly mode: SqliteDebugTableImportOptions['mode']
  readonly insertedRows: number
}

export interface SqliteDebugUndoState {
  readonly available: boolean
  readonly operation?: string
  readonly createdAt?: string
  readonly byteLength?: number
}

export interface SqliteDebugController {
  listTables: () => Promise<readonly SqliteDebugTable[]>
  describeTable: (tableName: string) => Promise<readonly SqliteDebugColumn[]>
  getTableCapabilities: (tableName: string) => Promise<SqliteDebugTableCapabilities>
  listIndexes: (tableName: string) => Promise<readonly SqliteDebugIndex[]>
  readTable: (tableName: string, options?: SqliteDebugReadOptions) => Promise<SqliteDebugPage>
  query: (sql: string, parameters?: SqliteParameters) => Promise<SqliteDebugQueryResult>
  execute: (sql: string, parameters?: SqliteParameters, options?: { readonly allowWrite?: boolean }) => Promise<SqliteDebugExecutionResult>
  insertRow: (tableName: string, values: Readonly<Record<string, SqliteScalar>>, options: SqliteDebugWriteOptions) => Promise<SqliteDebugExecutionResult>
  updateRow: (tableName: string, locator: SqliteDebugRowLocator, values: Readonly<Record<string, SqliteScalar>>, options: SqliteDebugWriteOptions) => Promise<SqliteDebugExecutionResult>
  deleteRows: (tableName: string, locators: readonly SqliteDebugRowLocator[], options: SqliteDebugDestructiveOptions) => Promise<SqliteDebugExecutionResult>
  createTable: (tableName: string, columns: readonly SqliteDebugColumnDefinition[], options: SqliteDebugWriteOptions) => Promise<void>
  renameTable: (tableName: string, newName: string, options: SqliteDebugDestructiveOptions) => Promise<void>
  dropTable: (tableName: string, options: SqliteDebugDestructiveOptions) => Promise<void>
  truncateTable: (tableName: string, options: SqliteDebugDestructiveOptions) => Promise<SqliteDebugExecutionResult>
  addColumn: (tableName: string, column: SqliteDebugColumnDefinition, options: SqliteDebugWriteOptions) => Promise<void>
  renameColumn: (tableName: string, columnName: string, newName: string, options: SqliteDebugDestructiveOptions) => Promise<void>
  dropColumn: (tableName: string, columnName: string, options: SqliteDebugDestructiveOptions) => Promise<void>
  createIndex: (tableName: string, indexName: string, columns: readonly SqliteDebugIndexColumn[], options: SqliteDebugWriteOptions & { readonly unique?: boolean }) => Promise<void>
  dropIndex: (tableName: string, indexName: string, options: SqliteDebugDestructiveOptions) => Promise<void>
  getMigrationStatus: () => Promise<SqliteDebugMigrationStatus>
  exportDatabase: () => Promise<SqliteDebugSnapshot>
  importDatabase: (bytes: Uint8Array | ArrayBuffer, options: { readonly replace: true }) => Promise<SqliteDebugSnapshotMetadata>
  exportTable: (tableName: string, options: { readonly format: SqliteDebugTableFormat }) => Promise<SqliteDebugTableArtifact>
  previewTableImport: (source: SqliteDebugTableImportSource, options?: { readonly sampleRows?: number }) => Promise<SqliteDebugImportPreview>
  importTable: (source: SqliteDebugTableImportSource, options: SqliteDebugTableImportOptions) => Promise<SqliteDebugTableImportResult>
  getUndoState: () => SqliteDebugUndoState
  undoLastDestructiveChange: () => Promise<void>
  resetDatabase: () => Promise<void>
  close: () => Promise<void>
}

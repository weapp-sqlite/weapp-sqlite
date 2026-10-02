import type { SqliteDatabase, SqliteMigration, SqliteParameters, SqliteQueryResult, SqliteScalar } from '@weapp-sqlite/core'
import type { SqliteWasmStorage } from '@weapp-sqlite/wasm'
import type { SqliteDebugSession } from './session'

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

interface SqliteDebugControllerBaseOptions {
  readonly databaseName: string
  readonly enabled?: boolean
  readonly limits?: SqliteDebugLimits
  readonly runtime?: SqliteDebugRuntimeInfo
  /** Expected application migrations used by the migration diagnostics panel. */
  readonly migrations?: readonly SqliteMigration[]
}

export type SqliteDebugControllerOptions = SqliteDebugControllerBaseOptions & (
  | { readonly openDatabase: () => Promise<SqliteDatabase>, readonly storage: SqliteDebugStorage, readonly session?: never }
  | { readonly session: SqliteDebugSession, readonly openDatabase?: never, readonly storage?: never }
)

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

/**
 * A keyset pagination position produced by `readTable()`.
 *
 * The complete effective order is included so a cursor cannot accidentally be
 * reused after the panel changes sorting. Values retain SQLite scalar types,
 * including bigint, BLOB and NULL.
 */
export interface SqliteDebugPageCursor {
  readonly orderBy: readonly SqliteDebugOrder[]
  readonly values: readonly SqliteScalar[]
}

export interface SqliteDebugReadOptions {
  readonly limit?: number
  readonly offset?: number
  /** Continue after the last row represented by this cursor. */
  readonly cursor?: SqliteDebugPageCursor
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
  /** Whether another page is available after this page. */
  readonly hasMore: boolean
  /** Keyset position for the next page, when the table has a stable locator. */
  readonly nextCursor?: SqliteDebugPageCursor
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

/** A single row returned by SQLite's `EXPLAIN QUERY PLAN` virtual table. */
export interface SqliteDebugQueryPlanNode {
  /** SQLite's stable identifier for this node in the current plan. */
  readonly id: number
  /** The parent node identifier, or -1 for the root node. */
  readonly parent: number
  /** SQLite's currently reserved detail column. */
  readonly notUsed: number
  /** Human-readable detail emitted by SQLite (for example `SEARCH users USING INDEX ...`). */
  readonly detail: string
  /** Tree depth derived from the parent links. */
  readonly depth: number
  readonly kind: 'scan' | 'search' | 'temporary-b-tree' | 'other'
  /** The operation that caused a temporary B-tree, when this is one. */
  readonly temporaryBTreeOperation?: SqliteDebugQueryPlanTemporaryBTreeOperation
  readonly table?: string
  readonly index?: string
}

export type SqliteDebugQueryPlanWarning = 'full-table-scan' | 'temporary-b-tree' | 'automatic-index'

/** The planner operation that required a temporary B-tree. */
export type SqliteDebugQueryPlanTemporaryBTreeOperation = 'order-by' | 'group-by' | 'distinct' | 'other'

/** Signals that can make a query slower as its input grows. */
export interface SqliteDebugQueryDiagnostics {
  /** Number of SCAN nodes that do not use an index. */
  readonly fullTableScans: number
  /** Number of `USE TEMP B-TREE` nodes. */
  readonly temporaryBtrees: number
  /** Operations represented by temporary B-tree nodes, in plan order. */
  readonly temporaryBTreeOperations: readonly SqliteDebugQueryPlanTemporaryBTreeOperation[]
  /** Number of automatic indexes selected by SQLite. */
  readonly automaticIndexes: number
  /** Names of indexes mentioned by the plan, in first-seen order. */
  readonly indexes: readonly string[]
  readonly warnings: readonly SqliteDebugQueryPlanWarning[]
  /** Convenience flags for clients that only need to render a warning state. */
  readonly fullTableScan: boolean
  readonly temporaryBTree: boolean
}

/** A read-only query analysis; the SQL itself is never executed. */
export interface SqliteDebugQueryAnalysis {
  readonly sql: string
  readonly nodes: readonly SqliteDebugQueryPlanNode[]
  readonly diagnostics: SqliteDebugQueryDiagnostics
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

export type SqliteDebugMigrationDiagnosticWarning = 'history-missing' | 'pending-migrations' | 'unknown-migrations' | 'migration-conflicts'

/** Read-only migration health information for the active runtime database. */
export interface SqliteDebugMigrationDiagnostics {
  readonly tablePresent: boolean
  readonly applied: readonly SqliteDebugMigration[]
  readonly expected: readonly SqliteDebugMigrationInfo[]
  readonly pending: readonly SqliteDebugMigrationInfo[]
  readonly unknown: readonly SqliteDebugMigration[]
  readonly conflicts: readonly {
    readonly version: number
    readonly appliedName: string
    readonly expectedName: string
  }[]
  readonly latestAppliedVersion?: number
  readonly latestExpectedVersion?: number
  readonly healthy: boolean
  readonly warnings: readonly SqliteDebugMigrationDiagnosticWarning[]
}

export interface SqliteDebugMigrationInfo {
  readonly version: number
  readonly name: string
}

export interface SqliteDebugForeignKeyConstraint {
  readonly table: string
  readonly id: number
  readonly sequence: number
  readonly referencedTable: string
  readonly from: string | null
  readonly to: string | null
  readonly onUpdate: string
  readonly onDelete: string
  readonly match: string
}

export interface SqliteDebugForeignKeyViolation {
  readonly table: string
  readonly rowid: number | bigint | string | null
  readonly parent: string
  readonly foreignKeyId: number
}

/**
 * A foreign-key declaration that SQLite cannot validate against the current
 * schema (for example, a parent key that is missing or not unique).
 */
export interface SqliteDebugForeignKeySchemaError {
  readonly table: string
  readonly message: string
}

export type SqliteDebugForeignKeyDiagnosticWarning = 'foreign-keys-disabled' | 'foreign-key-violations' | 'foreign-key-schema'

/** Read-only foreign-key pragma and integrity-check information. */
export interface SqliteDebugForeignKeyDiagnostics {
  readonly enabled: boolean
  readonly constraints: readonly SqliteDebugForeignKeyConstraint[]
  readonly violations: readonly SqliteDebugForeignKeyViolation[]
  /** Foreign-key schema mismatches found while running `foreign_key_check`. */
  readonly schemaErrors: readonly SqliteDebugForeignKeySchemaError[]
  readonly tableCount: number
  readonly constrainedTableCount: number
  readonly healthy: boolean
  readonly warnings: readonly SqliteDebugForeignKeyDiagnosticWarning[]
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
  analyzeQuery: (sql: string, parameters?: SqliteParameters) => Promise<SqliteDebugQueryAnalysis>
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
  getMigrationDiagnostics: () => Promise<SqliteDebugMigrationDiagnostics>
  getForeignKeyDiagnostics: () => Promise<SqliteDebugForeignKeyDiagnostics>
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

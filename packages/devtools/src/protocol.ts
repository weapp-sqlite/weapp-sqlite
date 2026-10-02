export const SQLITE_DEVTOOLS_SCOPE = 'weapp-sqlite'
export const SQLITE_DEVTOOLS_PROTOCOL = 1
export const SQLITE_DEVTOOLS_MAX_MESSAGE_BYTES = 16 * 1024 * 1024

export const SQLITE_DEVTOOLS_READ_METHODS = [
  'listTables',
  'describeTable',
  'getTableCapabilities',
  'listIndexes',
  'readTable',
  'query',
  'analyzeQuery',
  'getMigrationStatus',
  'getMigrationDiagnostics',
  'getForeignKeyDiagnostics',
  'exportDatabase',
  'exportTable',
  'previewTableImport',
  'getUndoState',
] as const
export const SQLITE_DEVTOOLS_WRITE_METHODS = [
  'execute',
  'insertRow',
  'updateRow',
  'deleteRows',
  'createTable',
  'renameTable',
  'dropTable',
  'truncateTable',
  'addColumn',
  'renameColumn',
  'dropColumn',
  'createIndex',
  'dropIndex',
  'importDatabase',
  'importTable',
  'undoLastDestructiveChange',
  'resetDatabase',
] as const
export type SqliteDevtoolsMethod = typeof SQLITE_DEVTOOLS_READ_METHODS[number] | typeof SQLITE_DEVTOOLS_WRITE_METHODS[number] | 'close'

export interface SqliteDevtoolsRuntime {
  readonly id: string
  readonly label: string
  readonly platform: string
}

export interface SqliteDevtoolsRuntimeDescriptor extends SqliteDevtoolsRuntime {
  readonly databases: readonly string[]
  readonly sessionId: string
  readonly connectedAt: string
  readonly readOnly: boolean
}

export interface SqliteDevtoolsErrorData {
  readonly code: string
  readonly message: string
}

export class SqliteDevtoolsError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'SqliteDevtoolsError'
  }
}

export type SqliteDevtoolsWireValue
  = | null | boolean | number | string
    | { readonly type: 'undefined' }
    | { readonly type: 'bigint', readonly value: string }
    | { readonly type: 'bytes', readonly value: string, readonly kind: 'uint8array' | 'arraybuffer' }
    | { readonly type: 'array', readonly value: readonly SqliteDevtoolsWireValue[] }
    | { readonly type: 'object', readonly value: readonly (readonly [string, SqliteDevtoolsWireValue])[] }

export type SqliteDevtoolsResult
  = | { readonly ok: true, readonly value: SqliteDevtoolsWireValue }
    | { readonly ok: false, readonly error: SqliteDevtoolsErrorData }

export interface SqliteDevtoolsInvocation {
  readonly runtimeId: string
  readonly sessionId: string
  readonly databaseName: string
  readonly method: SqliteDevtoolsMethod
  readonly args: SqliteDevtoolsWireValue
}

export function isSqliteDevtoolsMethod(value: unknown): value is SqliteDevtoolsMethod {
  return typeof value === 'string' && ([...SQLITE_DEVTOOLS_READ_METHODS, ...SQLITE_DEVTOOLS_WRITE_METHODS, 'close'] as readonly string[]).includes(value)
}

export function isSqliteDevtoolsWriteMethod(value: SqliteDevtoolsMethod) {
  return (SQLITE_DEVTOOLS_WRITE_METHODS as readonly string[]).includes(value)
}

export function serializeDevtoolsError(error: unknown): SqliteDevtoolsErrorData {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'SQLITE_DEVTOOLS_RUNTIME_ERROR'
    return { code, message: error.message.slice(0, 4096) }
  }
  return { code: 'SQLITE_DEVTOOLS_RUNTIME_ERROR', message: 'SQLite runtime operation failed.' }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isIdentifier(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    return false
  }
  return [...value].every(character => character.charCodeAt(0) >= 32)
}

export function validDatabaseNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every(isIdentifier) && new Set(value).size === value.length
}

export { decodeSqliteDevtoolsValue, encodeSqliteDevtoolsValue } from './codec'

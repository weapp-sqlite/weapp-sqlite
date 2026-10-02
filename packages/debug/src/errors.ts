export type SqliteDebugErrorCode
  = | 'SQLITE_DEBUG_DISABLED'
    | 'SQLITE_DEBUG_INVALID_IDENTIFIER'
    | 'SQLITE_DEBUG_READ_ONLY_SQL'
    | 'SQLITE_DEBUG_WRITE_CONFIRMATION_REQUIRED'
    | 'SQLITE_DEBUG_FORBIDDEN_SQL'
    | 'SQLITE_DEBUG_MULTIPLE_STATEMENTS'
    | 'SQLITE_DEBUG_RESULT_LIMIT_EXCEEDED'
    | 'SQLITE_DEBUG_INVALID_IMPORT'
    | 'SQLITE_DEBUG_IMPORT_TOO_LARGE'
    | 'SQLITE_DEBUG_STORAGE_UNSUPPORTED'
    | 'SQLITE_DEBUG_IMPORT_FAILED'
    | 'SQLITE_DEBUG_HASH_UNAVAILABLE'
    | 'SQLITE_DEBUG_PROTECTED_OBJECT'
    | 'SQLITE_DEBUG_OBJECT_NOT_FOUND'
    | 'SQLITE_DEBUG_OBJECT_CONFLICT'
    | 'SQLITE_DEBUG_OBJECT_READ_ONLY'
    | 'SQLITE_DEBUG_ROW_CONFLICT'
    | 'SQLITE_DEBUG_INVALID_FILTER'
    | 'SQLITE_DEBUG_INVALID_CURSOR'
    | 'SQLITE_DEBUG_CONFIRMATION_MISMATCH'
    | 'SQLITE_DEBUG_UNDO_UNAVAILABLE'
    | 'SQLITE_DEBUG_UNDO_STALE'
    | 'SQLITE_DEBUG_UNDO_TOO_LARGE'
    | 'SQLITE_DEBUG_EXPORT_TOO_LARGE'
    | 'SQLITE_DEBUG_IMPORT_ROW_LIMIT_EXCEEDED'
    | 'SQLITE_DEBUG_INVALID_MAPPING'

export class SqliteDebugError extends Error {
  readonly code: SqliteDebugErrorCode
  override readonly cause?: unknown

  constructor(code: SqliteDebugErrorCode, message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'SqliteDebugError'
    this.code = code
    this.cause = options?.cause
  }
}

function isStructuredSqliteDebugError(error: unknown): error is { readonly code: SqliteDebugErrorCode, readonly message: string } {
  if (error instanceof SqliteDebugError || !error || typeof error !== 'object') {
    return error instanceof SqliteDebugError
  }
  const value = error as { readonly code?: unknown, readonly message?: unknown }
  return typeof value.code === 'string'
    && value.code.startsWith('SQLITE_DEBUG_')
    && typeof value.message === 'string'
}

export function serializeSqliteDebugError(error: unknown) {
  if (isStructuredSqliteDebugError(error)) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof Error) {
    return { code: 'SQLITE_DEBUG_UNEXPECTED_ERROR', message: error.message }
  }
  if (error && typeof error === 'object') {
    try {
      return { code: 'SQLITE_DEBUG_UNEXPECTED_ERROR', message: JSON.stringify(error) }
    }
    catch {
      return { code: 'SQLITE_DEBUG_UNEXPECTED_ERROR', message: String(error) }
    }
  }
  return { code: 'SQLITE_DEBUG_UNEXPECTED_ERROR', message: String(error) }
}

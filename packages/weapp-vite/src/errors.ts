import type { SqliteRuntimeCapabilityReport, SqliteRuntimeTarget } from './types'

export type SqliteRuntimeErrorCode
  = | 'SQLITE_RUNTIME_UNSUPPORTED'
    | 'SQLITE_ENGINE_INIT_FAILED'
    | 'SQLITE_OPEN_OPTIONS_CONFLICT'

export class SqliteRuntimeError extends Error {
  readonly code: SqliteRuntimeErrorCode
  readonly target: SqliteRuntimeTarget
  readonly capability: string | undefined
  readonly hostCode: string | undefined

  constructor(
    code: SqliteRuntimeErrorCode,
    target: SqliteRuntimeTarget,
    message: string,
    options: { readonly capability?: string, readonly hostCode?: string, readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'SqliteRuntimeError'
    this.code = code
    this.target = target
    this.capability = options.capability
    this.hostCode = options.hostCode
  }
}

export function unsupportedRuntime(report: SqliteRuntimeCapabilityReport) {
  return new SqliteRuntimeError(
    'SQLITE_RUNTIME_UNSUPPORTED',
    report.target,
    report.message ?? `SQLite is unsupported on the ${report.target} runtime.`,
    {
      ...(report.capability === undefined ? {} : { capability: report.capability }),
      ...(report.code === undefined ? {} : { hostCode: report.code }),
    },
  )
}

export type SqliteScalar = string | number | bigint | boolean | Uint8Array | ArrayBuffer | null

export type SqliteParameters = readonly SqliteScalar[] | Readonly<Record<string, SqliteScalar>>

export interface SqliteRow {
  readonly [column: string]: unknown
}

export interface SqliteExecResult {
  readonly changes: number
  readonly lastInsertRowid?: number | bigint
}

export interface SqliteQueryResult<Row extends SqliteRow = SqliteRow> {
  readonly columns: readonly string[]
  readonly rows: readonly Row[]
}

export interface SqliteConnection {
  exec: (sql: string, parameters?: SqliteParameters) => Promise<SqliteExecResult>
  query: <Row extends SqliteRow = SqliteRow>(sql: string, parameters?: SqliteParameters) => Promise<SqliteQueryResult<Row>>
  flush?: () => Promise<void>
  close: () => Promise<void>
}

export interface SqliteTransaction {
  exec: (sql: string, parameters?: SqliteParameters) => Promise<SqliteExecResult>
  query: <Row extends SqliteRow = SqliteRow>(sql: string, parameters?: SqliteParameters) => Promise<SqliteQueryResult<Row>>
}

export interface SqliteDatabase {
  readonly name: string
  exec: (sql: string, parameters?: SqliteParameters) => Promise<SqliteExecResult>
  query: <Row extends SqliteRow = SqliteRow>(sql: string, parameters?: SqliteParameters) => Promise<SqliteQueryResult<Row>>
  transaction: <T>(callback: (transaction: SqliteTransaction) => Promise<T>) => Promise<T>
  close: () => Promise<void>
}

export interface SqliteDriver<Options = unknown> {
  readonly kind: string
  open: (name: string, options?: Options) => Promise<SqliteConnection>
}

export interface SqliteMigration {
  readonly version: number
  readonly name: string
  readonly up: (transaction: SqliteTransaction) => Promise<void>
}

import type { SqliteParameters, SqliteScalar } from '@weapp-vite/sqlite-core'

export type SqlJsScalar = Exclude<SqliteScalar, bigint | boolean | ArrayBuffer>
export type SqlJsParameters = SqlJsScalar[] | Record<string, SqlJsScalar> | null

export interface SqlJsResult {
  readonly columns: readonly string[]
  readonly values: readonly (readonly unknown[])[]
}

export interface SqlJsDatabase {
  run: (sql: string, parameters?: SqlJsParameters) => SqlJsDatabase
  exec: (sql: string, parameters?: SqlJsParameters) => readonly SqlJsResult[]
  export: () => Uint8Array
  close: () => void
}

export interface SqlJsModule {
  readonly Database: new (data?: ArrayLike<number> | null) => SqlJsDatabase
}

export type SqlJsInitializer = (options?: { locateFile?: (file: string) => string }) => Promise<SqlJsModule>

export interface SqliteWasmStorage {
  load: (name: string) => Promise<Uint8Array | undefined>
  save: (name: string, data: Uint8Array) => Promise<void>
}

export interface SqliteWasmDriverOptions {
  readonly storage: SqliteWasmStorage
  readonly locateFile?: (file: string) => string
}

export type SqliteWasmParameters = SqliteParameters

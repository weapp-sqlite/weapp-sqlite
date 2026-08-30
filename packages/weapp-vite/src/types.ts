import type { SqliteConnection, SqliteDatabase, SqliteMigration } from '@weapp-sqlite/core'

export type SqliteRuntimeTarget = 'web' | 'weapp' | 'alipay' | 'tt' | 'swan' | 'jd' | 'xhs'

export interface SqliteRuntimeCapabilityReport {
  readonly target: SqliteRuntimeTarget
  readonly supported: boolean
  readonly capability?: string
  readonly code?: string
  readonly message?: string
}

export interface SqliteRuntimeInfo {
  readonly target: SqliteRuntimeTarget
  readonly engine: string
  readonly system?: string
  readonly clientVersion?: string
  readonly sdkVersion?: string
  readonly brand?: string
  readonly model?: string
  readonly platform?: string
  readonly [key: string]: unknown
}

export interface SqliteRuntimeAdapter {
  readonly target: SqliteRuntimeTarget
  readonly kind: string
  probe: () => Promise<SqliteRuntimeCapabilityReport>
  open: (name: string) => Promise<SqliteConnection>
  loadSnapshot: (name: string) => Promise<Uint8Array | undefined>
  saveSnapshot: (name: string, bytes: Uint8Array) => Promise<void>
  remove: (name: string) => Promise<void>
  getRuntimeInfo: () => Promise<SqliteRuntimeInfo>
  getDatabasePath?: (name: string) => string | undefined
}

export interface OpenSqliteOptions {
  readonly name: string
  readonly migrations?: readonly SqliteMigration[]
  readonly adapter?: SqliteRuntimeAdapter
}

export interface RemoveSqliteOptions {
  readonly name: string
  readonly adapter?: SqliteRuntimeAdapter
}

export interface WeappSqlitePluginOptions {
  readonly debug?: boolean
}

export interface SqliteDebugRuntimeControllerOptions {
  readonly databaseName: string
  readonly migrations?: readonly SqliteMigration[]
  readonly adapter?: SqliteRuntimeAdapter
  readonly enabled?: boolean
  readonly limits?: {
    readonly maxRows?: number
    readonly maxResultBytes?: number
    readonly maxImportBytes?: number
  }
}

export type OpenedSqliteDatabase = SqliteDatabase

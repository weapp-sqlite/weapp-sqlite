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
  readonly debugFiles?: SqliteDebugFileAdapter
}

export interface SqliteDebugArtifact {
  readonly fileName: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export interface SqliteDebugChosenFile {
  readonly fileName: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export interface SqliteDebugFileSaveResult {
  readonly method: string
  readonly fileName: string
}

export interface SqliteDebugFileAdapter {
  save: (artifact: SqliteDebugArtifact) => Promise<SqliteDebugFileSaveResult>
  choose: (options?: { readonly extensions?: readonly string[], readonly maxBytes?: number }) => Promise<SqliteDebugChosenFile>
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

export interface WeappSqliteDebugPageOptions {
  readonly route?: string
  readonly configFile?: string
}

export interface WeappSqliteDebugPluginOptions {
  readonly enabled: boolean
  readonly page?: WeappSqliteDebugPageOptions
}

export type SqliteWasmVariant = 'full' | 'lite'

export type WeappSqliteWasmPackage
  = | 'main'
    | { readonly mode: 'generated-subpackage', readonly root?: string }
    | { readonly mode: 'existing-subpackage', readonly root: string }

export interface WeappSqlitePluginOptions {
  readonly debug?: boolean | WeappSqliteDebugPluginOptions
  readonly wasm?: {
    readonly variant?: SqliteWasmVariant
    readonly weappPackage?: WeappSqliteWasmPackage
  }
}

export interface WeappSqliteDebugAppConfigOptions {
  readonly enabled: boolean
  readonly route?: string
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
    readonly maxImportRows?: number
    readonly maxExportBytes?: number
    readonly maxExportRows?: number
    readonly maxUndoBytes?: number
  }
}

export interface SqliteDebugWorkspaceOptions extends SqliteDebugRuntimeControllerOptions {}

export type OpenedSqliteDatabase = SqliteDatabase

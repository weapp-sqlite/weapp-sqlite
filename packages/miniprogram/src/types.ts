import type { SqliteWasmStorage } from '@weapp-sqlite/wasm'

export type MiniProgramPlatform = 'weapp' | 'alipay' | 'tt' | 'swan' | 'jd' | 'xhs'

export type MiniProgramSqliteCapability
  = | 'platform'
    | 'runtime'
    | 'filesystem'
    | 'user-data-path'
    | 'typed-array'
    | 'webassembly'
    | 'package-binary'

export type MiniProgramSqliteErrorCode
  = | 'MINIPROGRAM_SQLITE_PLATFORM_UNSUPPORTED'
    | 'MINIPROGRAM_SQLITE_RUNTIME_UNAVAILABLE'
    | 'MINIPROGRAM_SQLITE_FILESYSTEM_UNAVAILABLE'
    | 'MINIPROGRAM_SQLITE_USER_DATA_PATH_UNAVAILABLE'
    | 'MINIPROGRAM_SQLITE_TYPED_ARRAY_UNAVAILABLE'
    | 'MINIPROGRAM_SQLITE_WEBASSEMBLY_UNAVAILABLE'
    | 'MINIPROGRAM_SQLITE_PACKAGE_BINARY_UNAVAILABLE'

export interface MiniProgramSqliteWasmStorage extends SqliteWasmStorage {
  remove: (name: string) => Promise<void>
}

export interface MiniProgramSqliteCapabilityReport {
  readonly platform: MiniProgramPlatform
  readonly supported: boolean
  readonly capability?: MiniProgramSqliteCapability
  readonly code?: MiniProgramSqliteErrorCode
  readonly message?: string
}

export interface MiniProgramHostAdapterOptions {
  readonly platform: MiniProgramPlatform
  readonly runtime: unknown
  readonly directoryName?: string
  readonly packageBinaryPath?: string
  readonly webAssembly?: unknown
}

export interface MiniProgramHostAdapter {
  probe: (options: MiniProgramHostAdapterOptions) => Promise<MiniProgramSqliteCapabilityReport>
  createStorage: (options: MiniProgramHostAdapterOptions) => MiniProgramSqliteWasmStorage
  loadPackageBinary: (path: string, options: MiniProgramHostAdapterOptions) => Promise<Uint8Array>
}

export interface MiniProgramSqliteOptions extends MiniProgramHostAdapterOptions {
  readonly adapter?: MiniProgramHostAdapter
}

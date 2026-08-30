import type { SqliteWasmStorage, SqlJsInitializer } from '@weapp-sqlite/wasm'

export type MiniProgramPlatform = 'weapp' | 'alipay' | 'tt' | 'swan' | 'jd' | 'xhs'

export type MiniProgramSqliteCapability
  = | 'platform'
    | 'runtime'
    | 'filesystem'
    | 'user-data-path'
    | 'typed-array'
    | 'webassembly'
    | 'wasm-instantiation'
    | 'package-binary'

export type MiniProgramSqliteErrorCode
  = | 'MINIPROGRAM_SQLITE_PLATFORM_UNSUPPORTED'
    | 'MINIPROGRAM_SQLITE_RUNTIME_UNAVAILABLE'
    | 'MINIPROGRAM_SQLITE_FILESYSTEM_UNAVAILABLE'
    | 'MINIPROGRAM_SQLITE_USER_DATA_PATH_UNAVAILABLE'
    | 'MINIPROGRAM_SQLITE_TYPED_ARRAY_UNAVAILABLE'
    | 'MINIPROGRAM_SQLITE_WEBASSEMBLY_UNAVAILABLE'
    | 'MINIPROGRAM_SQLITE_WEBASSEMBLY_INCOMPATIBLE'
    | 'MINIPROGRAM_SQLITE_WASM_INSTANTIATION_FAILED'
    | 'MINIPROGRAM_SQLITE_PACKAGE_BINARY_UNAVAILABLE'

export type MiniProgramWebAssemblyImports = Readonly<Record<string, Readonly<Record<string, unknown>>>>

export interface MiniProgramWebAssemblyInstance {
  readonly exports: Readonly<Record<string, unknown>>
}

export interface MiniProgramWebAssemblyInstantiationResult {
  readonly instance: MiniProgramWebAssemblyInstance
  readonly module?: unknown
}

export interface MiniProgramWebAssemblyRuntime {
  readonly instantiate: (
    source: string | Uint8Array,
    imports: MiniProgramWebAssemblyImports,
  ) => Promise<MiniProgramWebAssemblyInstance | MiniProgramWebAssemblyInstantiationResult>
  readonly Module: unknown
  readonly Instance: unknown
  readonly Memory: unknown
  readonly Table: unknown
  readonly RuntimeError?: unknown
}

export interface MiniProgramSqlJsFactoryOptions {
  readonly locateFile?: (file: string) => string
  readonly instantiateWasm: (
    imports: MiniProgramWebAssemblyImports,
    successCallback: (instance: MiniProgramWebAssemblyInstance, module?: unknown) => void,
  ) => Readonly<Record<string, unknown>> | undefined
}

export type MiniProgramSqlJsFactory = SqlJsInitializer

export interface MiniProgramSqliteWasmStorage extends SqliteWasmStorage {
  remove: (name: string) => Promise<void>
  getDatabasePath?: (name: string) => string
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
  instantiatePackageWasm?: (
    path: string,
    imports: MiniProgramWebAssemblyImports,
    options: MiniProgramHostAdapterOptions,
  ) => Promise<MiniProgramWebAssemblyInstantiationResult>
}

export interface MiniProgramSqliteOptions extends MiniProgramHostAdapterOptions {
  readonly adapter?: MiniProgramHostAdapter
}

export interface MiniProgramSqlJsInitializerOptions extends MiniProgramSqliteOptions {
  readonly initializer: MiniProgramSqlJsFactory
  readonly packageBinaryPath: string
}

export type MiniProgramSqlJsInitializer = SqlJsInitializer

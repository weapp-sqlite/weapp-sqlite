import type { MiniProgramPlatform, MiniProgramSqliteWasmStorage } from '@weapp-sqlite/miniprogram'
import type { SqliteWasmStorage, SqlJsInitializer } from '@weapp-sqlite/wasm'
import type { SqliteRuntimeAdapter, SqliteRuntimeInfo, SqliteRuntimeTarget } from './types'
import {
  createMiniProgramSqliteWasmStorage,
  createMiniProgramSqlJsInitializer,
  MiniProgramSqliteUnsupportedError,
  probeMiniProgramSqliteCapabilities,
} from '@weapp-sqlite/miniprogram'
import { createSqliteWasmDriver } from '@weapp-sqlite/wasm'
import { createIndexedDbSqliteWasmStorage, SqliteWebStorageUnavailableError } from '@weapp-sqlite/web'
import initSqlJs from 'sql.js'

export type {
  SqliteRuntimeAdapter,
  SqliteRuntimeCapabilityReport,
  SqliteRuntimeInfo,
  SqliteRuntimeTarget,
} from './types'

interface RuntimeSystemInfo {
  readonly brand?: string
  readonly model?: string
  readonly platform?: string
  readonly system?: string
  readonly version?: string
  readonly SDKVersion?: string
}

interface MiniProgramRuntimeInfoApi {
  readonly getAppBaseInfo?: () => Pick<RuntimeSystemInfo, 'SDKVersion' | 'version'>
  readonly getDeviceInfo?: () => Pick<RuntimeSystemInfo, 'brand' | 'model' | 'platform' | 'system'>
  readonly getSystemInfoSync?: () => RuntimeSystemInfo
}

export interface CreateSqliteWasmRuntimeAdapterOptions {
  readonly target: SqliteRuntimeTarget
  readonly kind?: string
  readonly initializer: SqlJsInitializer
  readonly storage: SqliteWasmStorage & { readonly remove: (name: string) => Promise<void>, readonly getDatabasePath?: (name: string) => string }
  readonly probe?: () => Promise<SqliteRuntimeCapabilityReport>
  readonly runtimeInfo?: () => Promise<Omit<SqliteRuntimeInfo, 'target' | 'engine'>> | Omit<SqliteRuntimeInfo, 'target' | 'engine'>
}

type SqliteRuntimeCapabilityReport = Awaited<ReturnType<SqliteRuntimeAdapter['probe']>>

export function createSqliteWasmRuntimeAdapter(options: CreateSqliteWasmRuntimeAdapterOptions): SqliteRuntimeAdapter {
  const driver = createSqliteWasmDriver(options.initializer, { storage: options.storage })
  const kind = options.kind ?? 'sql.js-wasm'
  return {
    target: options.target,
    kind,
    probe: options.probe ?? (async () => ({ target: options.target, supported: true })),
    open: name => driver.open(name),
    loadSnapshot: name => options.storage.load(name),
    saveSnapshot: (name, bytes) => options.storage.save(name, bytes),
    remove: name => options.storage.remove(name),
    async getRuntimeInfo() {
      return {
        target: options.target,
        engine: kind,
        ...await options.runtimeInfo?.(),
      }
    },
    ...(options.storage.getDatabasePath === undefined
      ? {}
      : { getDatabasePath: (name: string) => options.storage.getDatabasePath?.(name) }),
  }
}

export interface CreateWebSqliteRuntimeAdapterOptions {
  readonly wasmPath?: string
  readonly indexedDB?: IDBFactory
  readonly databaseName?: string
  readonly userAgent?: string
}

export function createWebSqliteRuntimeAdapter(options: CreateWebSqliteRuntimeAdapterOptions = {}): SqliteRuntimeAdapter {
  let storage: ReturnType<typeof createIndexedDbSqliteWasmStorage> | undefined
  const resolveStorage = () => storage ??= createIndexedDbSqliteWasmStorage({
    ...(options.indexedDB === undefined ? {} : { indexedDB: options.indexedDB }),
    ...(options.databaseName === undefined ? {} : { databaseName: options.databaseName }),
  })
  const initializer: SqlJsInitializer = initializerOptions => initSqlJs({
    locateFile: initializerOptions?.locateFile ?? (() => options.wasmPath ?? '/assets/sql-wasm-browser.wasm'),
  })
  let driver: ReturnType<typeof createSqliteWasmDriver> | undefined
  const resolveDriver = () => driver ??= createSqliteWasmDriver(initializer, { storage: resolveStorage() })

  return {
    target: 'web',
    kind: 'sql.js-wasm',
    async probe() {
      try {
        resolveStorage()
        if (typeof globalThis.WebAssembly !== 'object') {
          return {
            target: 'web',
            supported: false,
            capability: 'webassembly',
            code: 'WEB_SQLITE_WEBASSEMBLY_UNAVAILABLE',
            message: 'WebAssembly is unavailable in the current Web runtime.',
          }
        }
        return { target: 'web', supported: true }
      }
      catch (error) {
        if (error instanceof SqliteWebStorageUnavailableError) {
          return {
            target: 'web',
            supported: false,
            capability: 'storage',
            code: error.code,
            message: error.message,
          }
        }
        throw error
      }
    },
    open: name => resolveDriver().open(name),
    loadSnapshot: name => resolveStorage().load(name),
    saveSnapshot: (name, bytes) => resolveStorage().save(name, bytes),
    remove: name => resolveStorage().remove(name),
    async getRuntimeInfo() {
      return {
        target: 'web',
        engine: 'sql.js-wasm',
        userAgent: options.userAgent ?? globalThis.navigator?.userAgent,
      }
    },
  }
}

export interface CreateMiniProgramSqliteRuntimeAdapterOptions {
  readonly platform: MiniProgramPlatform
  readonly runtime: unknown
  readonly webAssembly?: unknown
  readonly packageBinaryPath?: string
  readonly directoryName?: string
}

function miniProgramRuntimeInfo(platform: MiniProgramPlatform, runtime: unknown): SqliteRuntimeInfo {
  const api = runtime && typeof runtime === 'object' ? runtime as MiniProgramRuntimeInfoApi : {}
  const legacy = !api.getAppBaseInfo || !api.getDeviceInfo ? api.getSystemInfoSync?.() ?? {} : {}
  const device = api.getDeviceInfo?.() ?? legacy
  const application = api.getAppBaseInfo?.() ?? legacy
  return {
    target: platform,
    engine: 'sql.js-wasm',
    ...(device.brand === undefined ? {} : { brand: device.brand }),
    ...(device.model === undefined ? {} : { model: device.model }),
    ...(device.platform === undefined ? {} : { platform: device.platform }),
    ...(device.system === undefined ? {} : { system: device.system }),
    ...(application.version === undefined ? {} : { clientVersion: application.version }),
    ...(application.SDKVersion === undefined ? {} : { sdkVersion: application.SDKVersion }),
  }
}

export function createMiniProgramSqliteRuntimeAdapter(
  options: CreateMiniProgramSqliteRuntimeAdapterOptions,
): SqliteRuntimeAdapter {
  const packageBinaryPath = options.packageBinaryPath ?? '/assets/sql-wasm.wasm'
  const hostOptions = {
    platform: options.platform,
    runtime: options.runtime,
    packageBinaryPath,
    ...(options.webAssembly === undefined ? {} : { webAssembly: options.webAssembly }),
    ...(options.directoryName === undefined ? {} : { directoryName: options.directoryName }),
  }
  let storage: MiniProgramSqliteWasmStorage | undefined
  const resolveStorage = () => storage ??= createMiniProgramSqliteWasmStorage(hostOptions)
  let driver: ReturnType<typeof createSqliteWasmDriver> | undefined
  const resolveDriver = () => driver ??= createSqliteWasmDriver(
    createMiniProgramSqlJsInitializer({ ...hostOptions, initializer: initSqlJs }),
    { storage: resolveStorage() },
  )

  return {
    target: options.platform,
    kind: 'sql.js-wasm',
    async probe() {
      const report = await probeMiniProgramSqliteCapabilities(hostOptions)
      return {
        target: report.platform,
        supported: report.supported,
        ...(report.capability === undefined ? {} : { capability: report.capability }),
        ...(report.code === undefined ? {} : { code: report.code }),
        ...(report.message === undefined ? {} : { message: report.message }),
      }
    },
    async open(name) {
      try {
        return await resolveDriver().open(name)
      }
      catch (error) {
        if (error instanceof MiniProgramSqliteUnsupportedError) {
          throw error
        }
        throw error
      }
    },
    loadSnapshot: name => resolveStorage().load(name),
    saveSnapshot: (name, bytes) => resolveStorage().save(name, bytes),
    remove: name => resolveStorage().remove(name),
    getRuntimeInfo: async () => miniProgramRuntimeInfo(options.platform, options.runtime),
    getDatabasePath: name => resolveStorage().getDatabasePath?.(name),
  }
}

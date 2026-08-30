import type {
  MiniProgramHostAdapter,
  MiniProgramPlatform,
  MiniProgramSqliteCapabilityReport,
  MiniProgramSqliteOptions,
  MiniProgramSqliteWasmStorage,
  MiniProgramSqlJsFactoryOptions,
  MiniProgramSqlJsInitializer,
  MiniProgramSqlJsInitializerOptions,
} from './types'
import { MiniProgramSqliteUnsupportedError } from './errors'
import { portableMiniProgramHostAdapter, weappHostAdapter } from './weapp'

export { createMiniProgramSqliteDebugFileAdapter } from './debug-files'

export type { MiniProgramSqliteDebugFileAdapterOptions } from './debug-files'
export { MiniProgramSqliteUnsupportedError } from './errors'
export type {
  MiniProgramHostAdapter,
  MiniProgramHostAdapterOptions,
  MiniProgramPlatform,
  MiniProgramSqliteCapability,
  MiniProgramSqliteCapabilityReport,
  MiniProgramSqliteDebugArtifact,
  MiniProgramSqliteDebugFile,
  MiniProgramSqliteDebugFileAdapter,
  MiniProgramSqliteDebugSaveResult,
  MiniProgramSqliteErrorCode,
  MiniProgramSqliteOptions,
  MiniProgramSqliteWasmStorage,
  MiniProgramSqlJsFactory,
  MiniProgramSqlJsFactoryOptions,
  MiniProgramSqlJsInitializer,
  MiniProgramSqlJsInitializerOptions,
  MiniProgramWebAssemblyImports,
  MiniProgramWebAssemblyInstance,
  MiniProgramWebAssemblyInstantiationResult,
  MiniProgramWebAssemblyRuntime,
} from './types'

const builtInAdapters: Partial<Record<MiniProgramPlatform, MiniProgramHostAdapter>> = {
  weapp: weappHostAdapter,
  alipay: portableMiniProgramHostAdapter,
  tt: portableMiniProgramHostAdapter,
  swan: portableMiniProgramHostAdapter,
  jd: portableMiniProgramHostAdapter,
  xhs: portableMiniProgramHostAdapter,
}

function platformUnsupported(platform: MiniProgramPlatform): MiniProgramSqliteUnsupportedError {
  return new MiniProgramSqliteUnsupportedError(
    platform,
    'platform',
    'MINIPROGRAM_SQLITE_PLATFORM_UNSUPPORTED',
    `SQLite host support for the ${platform} mini-program platform is not available.`,
  )
}

function resolveAdapter(options: MiniProgramSqliteOptions) {
  return options.adapter ?? builtInAdapters[options.platform]
}

export function createMiniProgramSqliteWasmStorage(options: MiniProgramSqliteOptions): MiniProgramSqliteWasmStorage {
  const adapter = resolveAdapter(options)
  if (!adapter) {
    throw platformUnsupported(options.platform)
  }
  return adapter.createStorage(options)
}

export async function loadMiniProgramPackageBinary(path: string, options: MiniProgramSqliteOptions): Promise<Uint8Array> {
  const adapter = resolveAdapter(options)
  if (!adapter) {
    throw platformUnsupported(options.platform)
  }
  return adapter.loadPackageBinary(path, options)
}

export async function probeMiniProgramSqliteCapabilities(
  options: MiniProgramSqliteOptions,
): Promise<MiniProgramSqliteCapabilityReport> {
  const adapter = resolveAdapter(options)
  if (!adapter) {
    const error = platformUnsupported(options.platform)
    return {
      platform: options.platform,
      supported: false,
      capability: error.capability,
      code: error.code,
      message: error.message,
    }
  }
  return adapter.probe(options)
}

export function createMiniProgramSqlJsInitializer(
  options: MiniProgramSqlJsInitializerOptions,
): MiniProgramSqlJsInitializer {
  const adapter = resolveAdapter(options)
  if (!adapter) {
    throw platformUnsupported(options.platform)
  }
  if (!adapter.instantiatePackageWasm) {
    throw new MiniProgramSqliteUnsupportedError(
      options.platform,
      'wasm-instantiation',
      'MINIPROGRAM_SQLITE_WEBASSEMBLY_INCOMPATIBLE',
      `SQLite WASM instantiation is not implemented for the ${options.platform} mini-program platform.`,
    )
  }

  return async (initializerOptions) => {
    let rejectInstantiation: (error: unknown) => void = () => undefined
    const instantiationFailure = new Promise<never>((_resolve, reject) => {
      rejectInstantiation = reject
    })
    const factoryOptions: MiniProgramSqlJsFactoryOptions = {
      ...(initializerOptions?.locateFile === undefined ? {} : { locateFile: initializerOptions.locateFile }),
      instantiateWasm(imports, successCallback) {
        void adapter.instantiatePackageWasm?.(options.packageBinaryPath, imports, options).then(
          result => successCallback(result.instance, result.module),
          rejectInstantiation,
        )
        return {}
      },
    }
    const initialize = options.initializer as unknown as (
      factoryOptions: MiniProgramSqlJsFactoryOptions,
    ) => ReturnType<MiniProgramSqlJsInitializer>
    return Promise.race([
      initialize(factoryOptions),
      instantiationFailure,
    ])
  }
}

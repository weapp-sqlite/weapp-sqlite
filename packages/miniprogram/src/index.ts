import type {
  MiniProgramHostAdapter,
  MiniProgramPlatform,
  MiniProgramSqliteCapabilityReport,
  MiniProgramSqliteOptions,
  MiniProgramSqliteWasmStorage,
} from './types'
import { MiniProgramSqliteUnsupportedError } from './errors'
import { weappHostAdapter } from './weapp'

export { MiniProgramSqliteUnsupportedError } from './errors'
export type {
  MiniProgramHostAdapter,
  MiniProgramHostAdapterOptions,
  MiniProgramPlatform,
  MiniProgramSqliteCapability,
  MiniProgramSqliteCapabilityReport,
  MiniProgramSqliteErrorCode,
  MiniProgramSqliteOptions,
  MiniProgramSqliteWasmStorage,
} from './types'

const builtInAdapters: Partial<Record<MiniProgramPlatform, MiniProgramHostAdapter>> = {
  weapp: weappHostAdapter,
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

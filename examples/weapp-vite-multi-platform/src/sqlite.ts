import type { AcceptanceSqliteStorage, SqliteAcceptanceResult } from '@weapp-sqlite/demo-shared'
import type { MiniProgramPlatform, MiniProgramSqliteCapabilityReport } from '@weapp-sqlite/miniprogram'
import type { SqlJsInitializer } from '@weapp-sqlite/wasm'
import {
  resetSqliteAcceptance,
  runSqliteAcceptance,
  verifySqliteAcceptance,
} from '@weapp-sqlite/demo-shared'
import {
  createMiniProgramSqliteWasmStorage,
  loadMiniProgramPackageBinary,
  MiniProgramSqliteUnsupportedError,
  probeMiniProgramSqliteCapabilities,
} from '@weapp-sqlite/miniprogram'
import { createIndexedDbSqliteWasmStorage } from '@weapp-sqlite/web'
import initSqlJs from 'sql.js'

const DATABASE_NAME = 'weapp-sqlite-acceptance-v1'
const WASM_PATH = 'assets/sql-wasm.wasm'
const miniProgramPlatforms: readonly MiniProgramPlatform[] = ['weapp', 'alipay', 'tt', 'swan', 'jd', 'xhs']

interface MiniProgramSystemInfo {
  readonly brand?: string
  readonly model?: string
  readonly platform?: string
  readonly system?: string
  readonly version?: string
  readonly SDKVersion?: string
}

interface MiniProgramRuntime {
  getSystemInfoSync?: () => MiniProgramSystemInfo
  setClipboardData?: (options: { data: string, success?: () => void, fail?: (error: unknown) => void }) => void
}

export interface AcceptanceEnvironment {
  readonly target: string
  readonly userAgent?: string
  readonly brand?: string
  readonly model?: string
  readonly platform?: string
  readonly system?: string
  readonly clientVersion?: string
  readonly sdkVersion?: string
}

export interface AcceptanceHost {
  readonly environment: AcceptanceEnvironment
  readonly storage: AcceptanceSqliteStorage
  readonly initializer: SqlJsInitializer
  readonly capability: MiniProgramSqliteCapabilityReport | { readonly platform: 'web', readonly supported: true }
  readonly copyText: (value: string) => Promise<void>
}

function isMiniProgramPlatform(value: string): value is MiniProgramPlatform {
  return miniProgramPlatforms.includes(value as MiniProgramPlatform)
}

function runtimeEnvironment(target: string, runtime: MiniProgramRuntime): AcceptanceEnvironment {
  const system = runtime.getSystemInfoSync?.() ?? {}
  return {
    target,
    ...(system.brand === undefined ? {} : { brand: system.brand }),
    ...(system.model === undefined ? {} : { model: system.model }),
    ...(system.platform === undefined ? {} : { platform: system.platform }),
    ...(system.system === undefined ? {} : { system: system.system }),
    ...(system.version === undefined ? {} : { clientVersion: system.version }),
    ...(system.SDKVersion === undefined ? {} : { sdkVersion: system.SDKVersion }),
  }
}

function copyWithMiniProgram(runtime: MiniProgramRuntime, value: string): Promise<void> {
  if (!runtime.setClipboardData) {
    return Promise.reject(new Error('The mini-program clipboard API is unavailable.'))
  }
  return new Promise((resolve, reject) => {
    runtime.setClipboardData?.({ data: value, success: resolve, fail: reject })
  })
}

let hostPromise: Promise<AcceptanceHost> | undefined

export function prepareAcceptanceHost(): Promise<AcceptanceHost> {
  return hostPromise ??= (async () => {
    const target = import.meta.env.PLATFORM ?? 'weapp'
    if (target === 'web') {
      return {
        environment: { target, userAgent: globalThis.navigator?.userAgent },
        storage: createIndexedDbSqliteWasmStorage({ databaseName: 'weapp-sqlite-acceptance' }),
        initializer: options => initSqlJs({ locateFile: options?.locateFile ?? (() => `/${WASM_PATH}`) }),
        capability: { platform: 'web', supported: true },
        copyText: value => globalThis.navigator.clipboard.writeText(value),
      }
    }
    if (!isMiniProgramPlatform(target)) {
      throw new Error(`Unknown mini-program target: ${target}`)
    }

    const runtime = wx as unknown as MiniProgramRuntime
    const options = {
      platform: target,
      runtime,
      packageBinaryPath: WASM_PATH,
      webAssembly: globalThis.WebAssembly,
    }
    const capability = await probeMiniProgramSqliteCapabilities(options)
    if (!capability.supported) {
      throw new MiniProgramSqliteUnsupportedError(
        target,
        capability.capability ?? 'runtime',
        capability.code ?? 'MINIPROGRAM_SQLITE_RUNTIME_UNAVAILABLE',
        capability.message ?? `SQLite is unsupported on ${target}.`,
      )
    }
    const wasmBinary = await loadMiniProgramPackageBinary(WASM_PATH, options)
    return {
      environment: runtimeEnvironment(target, runtime),
      storage: createMiniProgramSqliteWasmStorage(options),
      initializer: () => initSqlJs({ wasmBinary: Uint8Array.from(wasmBinary).buffer }),
      capability,
      copyText: value => copyWithMiniProgram(runtime, value),
    }
  })()
}

async function acceptanceOptions() {
  const host = await prepareAcceptanceHost()
  return {
    host,
    options: {
      storage: host.storage,
      initializer: host.initializer,
      databaseName: DATABASE_NAME,
      locateFile: (file: string) => `/assets/${file}`,
    },
  }
}

export async function resetPlatformSqliteAcceptance(): Promise<AcceptanceEnvironment> {
  const { host, options } = await acceptanceOptions()
  await resetSqliteAcceptance(options)
  return host.environment
}

export async function runPlatformSqliteAcceptance(): Promise<{ environment: AcceptanceEnvironment, result: SqliteAcceptanceResult }> {
  const { host, options } = await acceptanceOptions()
  return { environment: host.environment, result: await runSqliteAcceptance(options) }
}

export async function verifyPlatformSqliteAcceptance(): Promise<{ environment: AcceptanceEnvironment, result: SqliteAcceptanceResult }> {
  const { host, options } = await acceptanceOptions()
  return { environment: host.environment, result: await verifySqliteAcceptance(options) }
}

export async function copyAcceptanceReport(value: string): Promise<void> {
  const host = await prepareAcceptanceHost()
  await host.copyText(value)
}

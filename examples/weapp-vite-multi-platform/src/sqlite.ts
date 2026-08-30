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
  createMiniProgramSqlJsInitializer,
  MiniProgramSqliteUnsupportedError,
  probeMiniProgramSqliteCapabilities,
} from '@weapp-sqlite/miniprogram'
import { createIndexedDbSqliteWasmStorage } from '@weapp-sqlite/web'
import initSqlJs from 'sql.js'

const DATABASE_NAME = 'weapp-sqlite-acceptance-v1'
declare const WXWebAssembly: unknown

const MINIPROGRAM_WASM_PATH = '/assets/sql-wasm.wasm'
const WEB_WASM_PATH = '/assets/sql-wasm-browser.wasm'
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
  getAppBaseInfo?: () => Pick<MiniProgramSystemInfo, 'SDKVersion' | 'version'>
  getDeviceInfo?: () => Pick<MiniProgramSystemInfo, 'brand' | 'model' | 'platform' | 'system'>
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
  const legacy = !runtime.getDeviceInfo || !runtime.getAppBaseInfo ? runtime.getSystemInfoSync?.() ?? {} : {}
  const device = runtime.getDeviceInfo?.() ?? legacy
  const application = runtime.getAppBaseInfo?.() ?? legacy
  return {
    target,
    ...(device.brand === undefined ? {} : { brand: device.brand }),
    ...(device.model === undefined ? {} : { model: device.model }),
    ...(device.platform === undefined ? {} : { platform: device.platform }),
    ...(device.system === undefined ? {} : { system: device.system }),
    ...(application.version === undefined ? {} : { clientVersion: application.version }),
    ...(application.SDKVersion === undefined ? {} : { sdkVersion: application.SDKVersion }),
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
        initializer: options => initSqlJs({ locateFile: options?.locateFile ?? (() => WEB_WASM_PATH) }),
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
      packageBinaryPath: MINIPROGRAM_WASM_PATH,
      webAssembly: target === 'weapp' && typeof WXWebAssembly !== 'undefined' ? WXWebAssembly : undefined,
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
    return {
      environment: runtimeEnvironment(target, runtime),
      storage: createMiniProgramSqliteWasmStorage(options),
      initializer: createMiniProgramSqlJsInitializer({ ...options, initializer: initSqlJs }),
      capability,
      copyText: value => copyWithMiniProgram(runtime, value),
    }
  })()
}

export async function acceptanceOptions() {
  const host = await prepareAcceptanceHost()
  return {
    host,
    options: {
      storage: host.storage,
      initializer: host.initializer,
      databaseName: DATABASE_NAME,
      locateFile: host.environment.target === 'web' ? () => WEB_WASM_PATH : () => MINIPROGRAM_WASM_PATH,
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

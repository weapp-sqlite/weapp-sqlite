import type { SqliteAcceptanceResult } from '@weapp-sqlite/demo-shared'
import type { SqliteRuntimeInfo } from '@weapp-sqlite/weapp-vite/runtime'
import {
  resetSqliteAcceptance,
  runSqliteAcceptance,
  sqliteAcceptanceMigrations,
  verifySqliteAcceptance,
} from '@weapp-sqlite/demo-shared'
import {
  getSqliteRuntimeInfo,
  openSqlite,
  removeSqlite,
} from '@weapp-sqlite/weapp-vite/runtime'

export const DATABASE_NAME = 'weapp-sqlite-acceptance-v1'

declare const wpi: {
  setClipboardData: (options: { readonly data: string }) => Promise<unknown> | unknown
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

function acceptanceEnvironment(runtime: SqliteRuntimeInfo): AcceptanceEnvironment {
  return {
    target: runtime.target,
    ...(typeof runtime['userAgent'] !== 'string' ? {} : { userAgent: runtime['userAgent'] }),
    ...(runtime.brand === undefined ? {} : { brand: runtime.brand }),
    ...(runtime.model === undefined ? {} : { model: runtime.model }),
    ...(runtime.platform === undefined ? {} : { platform: runtime.platform }),
    ...(runtime.system === undefined ? {} : { system: runtime.system }),
    ...(runtime.clientVersion === undefined ? {} : { clientVersion: runtime.clientVersion }),
    ...(runtime.sdkVersion === undefined ? {} : { sdkVersion: runtime.sdkVersion }),
  }
}

function acceptanceOptions() {
  return {
    databaseName: DATABASE_NAME,
    openDatabase: () => openSqlite({ name: DATABASE_NAME, migrations: sqliteAcceptanceMigrations }),
    removeDatabase: () => removeSqlite({ name: DATABASE_NAME }),
  }
}

export async function resetPlatformSqliteAcceptance(): Promise<AcceptanceEnvironment> {
  await resetSqliteAcceptance(acceptanceOptions())
  return acceptanceEnvironment(await getSqliteRuntimeInfo())
}

export async function runPlatformSqliteAcceptance(): Promise<{ environment: AcceptanceEnvironment, result: SqliteAcceptanceResult }> {
  const result = await runSqliteAcceptance(acceptanceOptions())
  return { environment: acceptanceEnvironment(await getSqliteRuntimeInfo()), result }
}

export async function verifyPlatformSqliteAcceptance(): Promise<{ environment: AcceptanceEnvironment, result: SqliteAcceptanceResult }> {
  const result = await verifySqliteAcceptance(acceptanceOptions())
  return { environment: acceptanceEnvironment(await getSqliteRuntimeInfo()), result }
}

export async function copyAcceptanceReport(value: string): Promise<void> {
  await wpi.setClipboardData({ data: value })
}

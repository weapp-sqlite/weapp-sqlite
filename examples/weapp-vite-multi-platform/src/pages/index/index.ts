import type { SqliteAcceptanceCheck } from '@weapp-sqlite/demo-shared'
import type { AcceptanceEnvironment } from '../../sqlite'
import { getSqliteTarget, SqliteRuntimeError } from '@weapp-sqlite/weapp-vite/runtime'
import {
  copyAcceptanceReport,
  resetPlatformSqliteAcceptance,
  runPlatformSqliteAcceptance,
  verifyPlatformSqliteAcceptance,
} from '../../sqlite'

type AcceptancePhase = 'ready' | 'running' | 'first-pass' | 'persisted-pass' | 'failed' | 'unsupported'
const targetPlatform = getSqliteTarget()

interface AcceptancePageData {
  [key: string]: unknown
  platform: string
  acceptance: {
    schemaVersion: 1
    phase: AcceptancePhase
    passed: boolean
    environment: AcceptanceEnvironment
    checks: readonly SqliteAcceptanceCheck[]
    error?: { code: string, message: string } | null
  }
  report: string
}

interface AcceptancePageMethods {
  resetAcceptance: () => Promise<void>
  runAcceptance: () => Promise<void>
  verifyAcceptance: () => Promise<void>
  copyReport: () => Promise<void>
}

function initialAcceptance(): AcceptancePageData['acceptance'] {
  return { schemaVersion: 1, phase: 'ready', passed: false, environment: { target: targetPlatform }, checks: [] }
}

function serializeError(error: unknown) {
  if (error instanceof SqliteRuntimeError && error.code === 'SQLITE_RUNTIME_UNSUPPORTED') {
    return { phase: 'unsupported' as const, error: { code: error.code, message: error.message } }
  }
  const message = error instanceof Error
    ? error.message
    : (() => {
        try {
          return JSON.stringify(error)
        }
        catch {
          return String(error)
        }
      })()
  return { phase: 'failed' as const, error: { code: 'SQLITE_ACCEPTANCE_FAILED', message } }
}

Page<AcceptancePageData, AcceptancePageMethods>({
  data: { platform: targetPlatform, acceptance: initialAcceptance(), report: '' },
  async resetAcceptance() {
    this.setData({ acceptance: { ...initialAcceptance(), phase: 'running' }, report: '' })
    try {
      const environment = await resetPlatformSqliteAcceptance()
      const acceptance = { ...initialAcceptance(), environment }
      this.setData({ acceptance, report: JSON.stringify(acceptance) })
    }
    catch (error) {
      const failed = { ...initialAcceptance(), ...serializeError(error) }
      this.setData({ acceptance: failed, report: JSON.stringify(failed) })
    }
  },
  async runAcceptance() {
    this.setData({ acceptance: { ...this.data.acceptance, phase: 'running', error: null } })
    try {
      const { environment, result } = await runPlatformSqliteAcceptance()
      const acceptance = { schemaVersion: 1 as const, phase: result.passed ? 'first-pass' as const : 'failed' as const, passed: result.passed, environment, checks: result.checks }
      this.setData({ acceptance, report: JSON.stringify(acceptance) })
    }
    catch (error) {
      const failed = { ...initialAcceptance(), ...serializeError(error) }
      this.setData({ acceptance: failed, report: JSON.stringify(failed) })
    }
  },
  async verifyAcceptance() {
    this.setData({ acceptance: { ...this.data.acceptance, phase: 'running', error: null } })
    try {
      const { environment, result } = await verifyPlatformSqliteAcceptance()
      const acceptance = { schemaVersion: 1 as const, phase: result.passed ? 'persisted-pass' as const : 'failed' as const, passed: result.passed, environment, checks: result.checks }
      this.setData({ acceptance, report: JSON.stringify(acceptance) })
    }
    catch (error) {
      const failed = { ...initialAcceptance(), ...serializeError(error) }
      this.setData({ acceptance: failed, report: JSON.stringify(failed) })
    }
  },
  async copyReport() { await copyAcceptanceReport(this.data.report) },
})

import type { SqliteAcceptanceCheck } from '@weapp-sqlite/demo-shared'
import type { AcceptanceEnvironment } from '../../sqlite'
import { MiniProgramSqliteUnsupportedError } from '@weapp-sqlite/miniprogram'
import {
  copyAcceptanceReport,
  resetPlatformSqliteAcceptance,
  runPlatformSqliteAcceptance,
  verifyPlatformSqliteAcceptance,
} from '../../sqlite'

type AcceptancePhase = 'ready' | 'running' | 'first-pass' | 'persisted-pass' | 'failed' | 'unsupported'
const targetPlatform = import.meta.env.PLATFORM ?? 'weapp'

interface AcceptancePageData {
  [key: string]: unknown
  platform: string
  acceptance: {
    schemaVersion: 1
    phase: AcceptancePhase
    passed: boolean
    environment: AcceptanceEnvironment
    checks: readonly SqliteAcceptanceCheck[]
    error?: { code: string, message: string } | undefined
  }
  report: string
}

function initialAcceptance(): AcceptancePageData['acceptance'] {
  return {
    schemaVersion: 1,
    phase: 'ready',
    passed: false,
    environment: { target: targetPlatform },
    checks: [],
  }
}

function serializeError(error: unknown) {
  if (error instanceof MiniProgramSqliteUnsupportedError) {
    return { phase: 'unsupported' as const, error: { code: error.code, message: error.message } }
  }
  let message: string
  if (error instanceof Error) {
    message = error.message
  }
  else if (error && typeof error === 'object') {
    try {
      message = JSON.stringify(error)
    }
    catch {
      message = String(error)
    }
  }
  else {
    message = String(error)
  }
  return {
    phase: 'failed' as const,
    error: {
      code: 'SQLITE_ACCEPTANCE_FAILED',
      message,
    },
  }
}

Page<AcceptancePageData>({
  data: {
    platform: targetPlatform,
    acceptance: initialAcceptance(),
    report: '',
  },
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
    this.setData({ acceptance: { ...this.data.acceptance, phase: 'running', error: undefined } })
    try {
      const { environment, result } = await runPlatformSqliteAcceptance()
      const acceptance = {
        schemaVersion: 1 as const,
        phase: result.passed ? 'first-pass' as const : 'failed' as const,
        passed: result.passed,
        environment,
        checks: result.checks,
      }
      this.setData({ acceptance, report: JSON.stringify(acceptance) })
    }
    catch (error) {
      const failed = { ...initialAcceptance(), ...serializeError(error) }
      this.setData({ acceptance: failed, report: JSON.stringify(failed) })
    }
  },
  async verifyAcceptance() {
    this.setData({ acceptance: { ...this.data.acceptance, phase: 'running', error: undefined } })
    try {
      const { environment, result } = await verifyPlatformSqliteAcceptance()
      const acceptance = {
        schemaVersion: 1 as const,
        phase: result.passed ? 'persisted-pass' as const : 'failed' as const,
        passed: result.passed,
        environment,
        checks: result.checks,
      }
      this.setData({ acceptance, report: JSON.stringify(acceptance) })
    }
    catch (error) {
      const failed = { ...initialAcceptance(), ...serializeError(error) }
      this.setData({ acceptance: failed, report: JSON.stringify(failed) })
    }
  },
  async copyReport() {
    await copyAcceptanceReport(this.data.report)
  },
})

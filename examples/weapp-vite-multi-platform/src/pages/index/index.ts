import type { SqliteDebugColumn, SqliteDebugPage, SqliteDebugSnapshotMetadata, SqliteDebugTable } from '@weapp-sqlite/debug'
import type { SqliteAcceptanceCheck } from '@weapp-sqlite/demo-shared'
import type { AcceptanceEnvironment } from '../../sqlite'
import { getSqliteTarget, SqliteRuntimeError } from '@weapp-sqlite/weapp-vite/runtime'
import { closeDebugPageController, createDebugPageMethods } from '../../debug-page'
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
    error?: { code: string, message: string } | undefined
  }
  report: string
  debugEnabled?: boolean
  debug?: {
    tables: readonly SqliteDebugTable[]
    selectedTable: string
    columns: readonly SqliteDebugColumn[]
    page: SqliteDebugPage | undefined
    pageLabel: string
    displayRows: readonly string[]
    sql: string
    result: string
    snapshot: SqliteDebugSnapshotMetadata | undefined
    error?: { code: string, message: string } | undefined
  }
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
  if (error instanceof SqliteRuntimeError && error.code === 'SQLITE_RUNTIME_UNSUPPORTED') {
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

const debugInitialData = __WEAPP_SQLITE_DEBUG__
  ? {
      debugEnabled: true,
      debug: {
        tables: [] as readonly SqliteDebugTable[],
        selectedTable: '',
        columns: [] as readonly SqliteDebugColumn[],
        page: undefined as SqliteDebugPage | undefined,
        pageLabel: '0 / 0',
        displayRows: [],
        sql: 'SELECT * FROM notes ORDER BY id',
        result: '',
        snapshot: undefined as SqliteDebugSnapshotMetadata | undefined,
      },
    }
  : {}

Page<AcceptancePageData>({
  data: {
    platform: targetPlatform,
    acceptance: initialAcceptance(),
    report: '',
    ...debugInitialData,
  },
  async resetAcceptance() {
    if (__WEAPP_SQLITE_DEBUG__) {
      await closeDebugPageController()
    }
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
    if (__WEAPP_SQLITE_DEBUG__) {
      await closeDebugPageController()
    }
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
    if (__WEAPP_SQLITE_DEBUG__) {
      await closeDebugPageController()
    }
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
  onUnload() {
    if (__WEAPP_SQLITE_DEBUG__) {
      void closeDebugPageController()
    }
  },
  ...(__WEAPP_SQLITE_DEBUG__ ? createDebugPageMethods() : {}),
})

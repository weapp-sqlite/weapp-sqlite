import type { MiniProgram, Page } from '@weapp-vite/miniprogram-automator'
import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Launcher } from '@weapp-vite/miniprogram-automator'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { acceptanceArtifactRoot, demoRoot } from '../../scripts/acceptance-paths'

interface WorkspaceState {
  readonly phase: string
  readonly selectedTable: string
  readonly tables: readonly { readonly name: string }[]
  readonly columns: readonly { readonly name: string }[]
  readonly indexes: readonly { readonly name: string }[]
  readonly page?: { readonly total: number, readonly limit: number, readonly offset: number }
  readonly error?: { readonly code: string, readonly message: string }
}

interface PageAcceptance {
  readonly phase: string
  readonly passed: boolean
  readonly error?: { readonly code: string, readonly message: string }
}

const launcher = new Launcher()
const runtimeLogs: string[] = []
const runtimeFailures: string[] = []
let miniProgram: MiniProgram

function runtimeDetail(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, (_key, item) => item instanceof Error ? { message: item.message, stack: item.stack } : item)
  }
  catch {
    return String(value)
  }
}

function runtimeLog(kind: string, value: unknown) {
  runtimeLogs.push(`${new Date().toISOString()} ${kind} ${runtimeDetail(value)}`)
}

function consoleLevel(value: unknown) {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const message = value as Record<string, unknown>
  return message['type'] ?? message['level'] ?? message['method']
}

async function waitForAcceptance(page: Page, phase: string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const acceptance = await page.data('acceptance') as PageAcceptance
    if (acceptance.phase === phase) {
      return acceptance
    }
    if (acceptance.phase === 'failed' || acceptance.phase === 'unsupported') {
      throw new Error(`Acceptance entered ${acceptance.phase}: ${JSON.stringify(acceptance)}`)
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for acceptance phase ${phase}.`)
}

async function waitForWorkspace(page: Page, predicate: (state: WorkspaceState) => boolean) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const state = await page.callMethodWithOptions('workspaceStateForAutomation', { routeOnly: true, timeout: 60_000 }) as WorkspaceState
    if (state.phase === 'failed' || state.phase === 'unsupported' || state.error) {
      throw new Error(`Workspace failed: ${JSON.stringify(state)}`)
    }
    if (predicate(state)) {
      return state
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('Timed out waiting for SQLite workspace state.')
}

function callWorkspace(page: Page, method: string, ...args: unknown[]) {
  return page.callMethodWithOptions(method, { routeOnly: true, timeout: 60_000 }, ...args)
}

beforeAll(async () => {
  miniProgram = await launcher.launch({
    platform: 'wechat',
    projectPath: path.join(demoRoot, 'dist/weapp'),
    runtimeProvider: 'devtools',
    trustProject: true,
    timeout: 120_000,
  }) as MiniProgram
  if (typeof miniProgram.waitForAppReady === 'function') {
    await miniProgram.waitForAppReady(60_000)
  }
  if (typeof miniProgram.on === 'function') {
    miniProgram.on('console', (value) => {
      runtimeLog('console', value)
      if (consoleLevel(value) === 'error') {
        runtimeFailures.push(`console: ${runtimeDetail(value)}`)
      }
    })
    miniProgram.on('exception', (value) => {
      runtimeLog('exception', value)
      runtimeFailures.push(`exception: ${runtimeDetail(value)}`)
    })
  }
  if (typeof miniProgram.enableLog === 'function') {
    await miniProgram.enableLog()
  }
})

afterAll(async () => {
  await miniProgram?.close()
})

it('manages and persists SQLite through the generated DevTools workspace', async () => {
  const { commit, root } = await acceptanceArtifactRoot()
  const output = path.join(root, 'devtools-debug')
  await mkdir(output, { recursive: true })
  let page: Page | undefined
  let state: WorkspaceState | undefined
  let stage = 'open acceptance page'
  try {
    page = await miniProgram.reLaunch('/pages/index/index')
    await page.callMethod('resetAcceptance')
    await waitForAcceptance(page, 'ready')
    runtimeFailures.length = 0
    await page.callMethod('runAcceptance')
    await waitForAcceptance(page, 'first-pass')

    stage = 'open debug workspace'
    page = await miniProgram.reLaunch('/__weapp_sqlite_debug/index/index')
    state = await waitForWorkspace(page, value => value.phase === 'ready' && value.tables.some(table => table.name === 'notes'))
    expect(state.columns.map(column => column.name)).toContain('body')
    const count = await callWorkspace(page, 'queryForAutomation', 'SELECT count(*) AS total FROM notes') as { rows: readonly { total: number }[] }
    expect(count.rows[0]?.total).toBeGreaterThan(0)

    stage = 'manage table through page handlers'
    await page.setData({ formName: 'devtools_audit', formValue: 'message' })
    await page.callMethod('createTable')
    await waitForWorkspace(page, value => value.tables.some(table => table.name === 'devtools_audit'))
    await page.callMethod('undoLast')
    await waitForWorkspace(page, value => !value.tables.some(table => table.name === 'devtools_audit'))

    stage = 'write and paginate workspace data'
    await callWorkspace(page, 'executeForAutomation', 'INSERT INTO notes (body) VALUES (\'devtools-workspace-write\')')
    await callWorkspace(page, 'executeForAutomation', 'WITH RECURSIVE seq(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM seq WHERE value < 55) INSERT INTO notes (body) SELECT \'page-row-\' || value FROM seq')
    await page.callMethod('nextPage')
    state = await waitForWorkspace(page, value => value.page?.offset === 50)
    expect(state.page?.total).toBeGreaterThan(50)

    stage = 'export workspace artifacts'
    const sqliteArtifact = await callWorkspace(page, 'exportArtifactForAutomation', 'sqlite') as { bytes: string, metadata: { byteLength: number, sha256: string } }
    const sqlite = Buffer.from(sqliteArtifact.bytes, 'base64')
    expect(sqlite.subarray(0, 16).toString()).toBe('SQLite format 3\0')
    expect(sqlite.byteLength).toBe(sqliteArtifact.metadata.byteLength)
    await writeFile(path.join(output, 'workspace.sqlite'), sqlite)

    stage = 'restore exported database through import bridge'
    await callWorkspace(page, 'executeForAutomation', 'INSERT INTO notes (body) VALUES (\'discarded-by-import\')')
    await callWorkspace(page, 'importArtifactForAutomation', sqliteArtifact.bytes)
    const restored = await callWorkspace(page, 'queryForAutomation', 'SELECT count(*) AS total FROM notes WHERE body = \'discarded-by-import\'') as { rows: readonly { total: number }[] }
    expect(restored.rows[0]?.total).toBe(0)

    stage = 'export table artifacts'
    const csvArtifact = await callWorkspace(page, 'exportArtifactForAutomation', 'csv') as { bytes: string, rowCount: number }
    const jsonArtifact = await callWorkspace(page, 'exportArtifactForAutomation', 'json') as { bytes: string, rowCount: number }
    expect(csvArtifact.rowCount).toBeGreaterThan(50)
    expect(jsonArtifact.rowCount).toBe(csvArtifact.rowCount)
    await writeFile(path.join(output, 'notes.csv'), Buffer.from(csvArtifact.bytes, 'base64'))
    await writeFile(path.join(output, 'notes.json'), Buffer.from(jsonArtifact.bytes, 'base64'))
    stage = 'capture workspace screenshot'
    await miniProgram.screenshot({ path: path.join(output, 'workspace.png'), timeout: 60_000 })

    stage = 'verify persisted workspace'
    page = await miniProgram.reLaunch('/pages/index/index')
    page = await miniProgram.reLaunch('/__weapp_sqlite_debug/index/index')
    await waitForWorkspace(page, value => value.phase === 'ready')
    const persisted = await callWorkspace(page, 'queryForAutomation', 'SELECT count(*) AS total FROM notes WHERE body = \'devtools-workspace-write\'') as { rows: readonly { total: number }[] }
    expect(persisted.rows[0]?.total).toBe(1)
    expect(runtimeFailures).toEqual([])
    stage = 'capture persisted screenshot'
    await miniProgram.screenshot({ path: path.join(output, 'persisted.png'), timeout: 60_000 })

    await writeFile(path.join(output, 'report.json'), `${JSON.stringify({
      schemaVersion: 2,
      commit,
      target: 'devtools-debug-workspace',
      passed: true,
      supportEvidence: true,
      checks: { state, tableManagement: true, importRestore: true, sqlite: sqliteArtifact.metadata, csvRows: csvArtifact.rowCount, jsonRows: jsonArtifact.rowCount, runtimeFailures },
      artifacts: { database: 'workspace.sqlite', tables: ['notes.csv', 'notes.json'] },
      screenshots: { first: 'workspace.png', persisted: 'persisted.png' },
    }, null, 2)}\n`)
    await writeFile(path.join(output, 'runtime.log'), `${runtimeLogs.join('\n')}\n`)
  }
  catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    const message = `${stage}: ${detail}`
    runtimeLog('debug-workspace-error', message)
    try {
      state = page ? await callWorkspace(page, 'workspaceStateForAutomation') as WorkspaceState : undefined
    }
    catch (stateError) {
      runtimeLog('workspace-state-error', stateError)
    }
    try {
      await miniProgram.screenshot({ path: path.join(output, 'failure.png') })
    }
    catch (screenshotError) {
      runtimeLog('screenshot-error', screenshotError)
    }
    await writeFile(path.join(output, 'report.json'), `${JSON.stringify({ schemaVersion: 2, commit, target: 'devtools-debug-workspace', passed: false, checks: { state, runtimeFailures }, error: message }, null, 2)}\n`)
    await writeFile(path.join(output, 'runtime.log'), `${runtimeLogs.join('\n')}\n`)
    throw error
  }
})

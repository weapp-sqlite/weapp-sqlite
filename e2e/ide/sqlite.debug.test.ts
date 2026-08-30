import type { MiniProgram, Page } from '@weapp-vite/miniprogram-automator'
import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Launcher } from '@weapp-vite/miniprogram-automator'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { acceptanceArtifactRoot, demoRoot } from '../../scripts/acceptance-paths'

interface DebugPageData {
  readonly selectedTable: string
  readonly tables: readonly { readonly name: string }[]
  readonly columns: readonly { readonly name: string }[]
  readonly page?: { readonly total: number, readonly limit: number, readonly offset: number }
  readonly displayRows: readonly string[]
  readonly snapshot?: { readonly databaseName: string, readonly byteLength: number, readonly sha256: string }
  readonly error?: { readonly code: string, readonly message: string }
}

interface DebugArtifact {
  readonly metadata: { readonly databaseName: string, readonly byteLength: number, readonly sha256: string }
  readonly base64: string
  readonly filePath?: string
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

function runtimeJsonReplacer(_key: string, value: unknown) {
  if (!value || typeof value !== 'object') {
    return value
  }
  const properties = Object.getOwnPropertyNames(value)
  if (!properties.includes('message') && !properties.includes('stack')) {
    return value
  }
  return Object.fromEntries(properties.map(property => [property, (value as Record<string, unknown>)[property]]))
}

function runtimeDetail(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, runtimeJsonReplacer)
}

function runtimeLog(kind: string, value: unknown) {
  let detail: string
  try {
    detail = runtimeDetail(value)
  }
  catch {
    detail = String(value)
  }
  runtimeLogs.push(`${new Date().toISOString()} ${kind} ${detail}`)
}

function consoleLevel(value: unknown) {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const message = value as Record<string, unknown>
  return message['type'] ?? message['level'] ?? message['method']
}

async function waitForPhase(page: Page, phase: string): Promise<PageAcceptance> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const acceptance = await page.data('acceptance') as PageAcceptance
    if (acceptance.phase === phase) {
      return acceptance
    }
    if (acceptance.phase === 'failed' || acceptance.phase === 'unsupported') {
      throw new Error(`DevTools debug setup entered ${acceptance.phase}: ${JSON.stringify(acceptance)}`)
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for DevTools debug setup phase ${phase}.`)
}

async function waitForDebug(page: Page, predicate: (debug: DebugPageData) => boolean) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const debug = await page.data('debug') as DebugPageData
    if (debug.error) {
      throw new Error(`DevTools debug panel failed: ${JSON.stringify(debug.error)}`)
    }
    if (predicate(debug)) {
      return debug
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for DevTools debug Page data.')
}

function callDebugMethod(page: Page, method: string, ...args: unknown[]) {
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

it('manages and persists SQLite through the DevTools debug bridge', async () => {
  const { commit, root } = await acceptanceArtifactRoot()
  const output = path.join(root, 'devtools-debug')
  await mkdir(output, { recursive: true })

  let page: Page | undefined
  let debug: DebugPageData | undefined
  try {
    page = await miniProgram.reLaunch('/pages/index/index')
    await page.callMethod('resetAcceptance')
    await waitForPhase(page, 'ready')
    runtimeFailures.length = 0
    await page.callMethod('runAcceptance')
    await waitForPhase(page, 'first-pass')
    await page.callMethod('refreshDebug')

    debug = await waitForDebug(page, value => value.tables.some(table => table.name === 'notes'))
    expect(debug.error).toBeUndefined()
    expect(debug.tables.map(table => table.name)).toContain('notes')
    expect(debug.columns.map(column => column.name)).toContain('body')
    expect(debug.displayRows.join('\n')).toContain('SQLite works across frameworks')

    const count = await callDebugMethod(page, 'queryDebugForAutomation', 'SELECT count(*) AS total FROM notes') as { rows: readonly { total: number }[] }
    expect(count.rows[0]?.total).toBeGreaterThan(0)
    const write = await callDebugMethod(page, 'executeDebugWriteForAutomation', 'INSERT INTO notes (body) VALUES (\'devtools-debug-write\')') as { changes: number }
    expect(write.changes).toBe(1)
    await callDebugMethod(page, 'executeDebugWriteForAutomation', 'WITH RECURSIVE seq(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM seq WHERE value < 55) INSERT INTO notes (body) SELECT \'page-row-\' || value FROM seq')
    await page.callMethod('nextDebugPage')
    debug = await waitForDebug(page, value => value.page?.offset === 50)
    expect(debug.page?.offset).toBe(50)
    expect(debug.displayRows.length).toBeGreaterThan(0)

    const artifact = await callDebugMethod(page, 'exportDebugArtifact') as DebugArtifact
    const sqlite = Buffer.from(artifact.base64, 'base64')
    expect(sqlite.subarray(0, 16).toString()).toBe('SQLite format 3\0')
    expect(sqlite.byteLength).toBe(artifact.metadata.byteLength)
    await writeFile(path.join(output, 'debug-export.sqlite'), sqlite)

    await page.callMethod('resetDebug')
    await callDebugMethod(page, 'importDebugArtifact', artifact.base64)
    const imported = await callDebugMethod(page, 'queryDebugForAutomation', 'SELECT count(*) AS total FROM notes WHERE body = \'devtools-debug-write\'') as { rows: readonly { total: number }[] }
    expect(imported.rows[0]?.total).toBe(1)
    await callDebugMethod(page, 'closeDebugController')
    await miniProgram.screenshot({ path: path.join(output, 'managed.png') })

    page = await miniProgram.reLaunch('/pages/index/index')
    const persisted = await callDebugMethod(page, 'queryDebugForAutomation', 'SELECT count(*) AS total FROM notes WHERE body = \'devtools-debug-write\'') as { rows: readonly { total: number }[] }
    expect(persisted.rows[0]?.total).toBe(1)
    await page.callMethod('refreshDebug')
    debug = await waitForDebug(page, value => Boolean(value.snapshot?.sha256))
    expect(debug.snapshot?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(runtimeFailures).toEqual([])
    await miniProgram.screenshot({ path: path.join(output, 'persisted.png') })

    await writeFile(path.join(output, 'report.json'), `${JSON.stringify({
      schemaVersion: 1,
      commit,
      target: 'devtools-debug',
      passed: true,
      supportEvidence: true,
      checks: { debug, artifact: artifact.metadata, filePath: artifact.filePath, runtimeFailures },
      artifacts: { database: 'debug-export.sqlite', screenshots: ['managed.png', 'persisted.png'] },
    }, null, 2)}\n`)
    await writeFile(path.join(output, 'runtime.log'), `${runtimeLogs.join('\n')}\n`)
  }
  catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    runtimeLog('debug-acceptance-error', message)
    try {
      debug = await page?.data('debug') as DebugPageData | undefined
    }
    catch (dataError) {
      runtimeLog('page-data-error', dataError)
    }
    let failureScreenshot: string | undefined
    try {
      failureScreenshot = 'failure.png'
      await miniProgram.screenshot({ path: path.join(output, failureScreenshot) })
    }
    catch (screenshotError) {
      failureScreenshot = undefined
      runtimeLog('screenshot-error', screenshotError)
    }
    await writeFile(path.join(output, 'report.json'), `${JSON.stringify({
      schemaVersion: 1,
      commit,
      target: 'devtools-debug',
      passed: false,
      checks: { debug, runtimeFailures },
      error: message,
      artifacts: failureScreenshot ? { screenshots: [failureScreenshot] } : {},
    }, null, 2)}\n`)
    await writeFile(path.join(output, 'runtime.log'), `${runtimeLogs.join('\n')}\n`)
    throw error
  }
})

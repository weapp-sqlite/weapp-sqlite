import type { MiniProgram, Page } from '@weapp-vite/miniprogram-automator'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Launcher } from '@weapp-vite/miniprogram-automator'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { acceptanceArtifactRoot, demoRoot } from '../../scripts/acceptance-paths'

interface PageAcceptance {
  readonly schemaVersion: 1
  readonly phase: string
  readonly passed: boolean
  readonly checks: readonly { readonly id: string, readonly passed: boolean, readonly detail: string }[]
  readonly error?: { readonly code: string, readonly message: string }
}

const runtimeProvider = process.env['WEAPP_VITE_E2E_RUNTIME_PROVIDER'] === 'headless' ? 'headless' : 'devtools'
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
      throw new Error(`DevTools acceptance entered ${acceptance.phase}: ${JSON.stringify(acceptance)}`)
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for DevTools acceptance phase ${phase}.`)
}

beforeAll(async () => {
  miniProgram = await launcher.launch({
    platform: 'wechat',
    projectPath: path.join(demoRoot, 'dist/weapp'),
    runtimeProvider,
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

it('runs provider-compatible SQLite acceptance', async () => {
  const { commit, root } = await acceptanceArtifactRoot()
  const output = path.join(root, runtimeProvider)
  await mkdir(output, { recursive: true })

  let page: Page | undefined
  try {
    page = await miniProgram.reLaunch('/pages/index/index')
    await page.callMethod('resetAcceptance')
    if (runtimeProvider === 'headless') {
      const preflight = await page.data('acceptance') as PageAcceptance
      if (preflight.phase === 'unsupported') {
        expect(preflight.error?.code).toBe('MINIPROGRAM_SQLITE_USER_DATA_PATH_UNAVAILABLE')
        await writeFile(path.join(output, 'report.json'), `${JSON.stringify({
          schemaVersion: 1,
          commit,
          target: runtimeProvider,
          passed: true,
          checks: { unsupportedContract: preflight },
          supportEvidence: false,
        }, null, 2)}\n`)
        await writeFile(path.join(output, 'runtime.log'), `${runtimeLogs.join('\n')}\n`)
        return
      }
    }
    await waitForPhase(page, 'ready')
    runtimeFailures.length = 0
    await page.callMethod('runAcceptance')
    const first = await waitForPhase(page, 'first-pass')
    expect(first.passed).toBe(true)
    expect(first.checks.every(check => check.passed)).toBe(true)
    await miniProgram.screenshot({ path: path.join(output, 'first.png') })

    page = await miniProgram.reLaunch('/pages/index/index')
    await page.callMethod('verifyAcceptance')
    const persisted = await waitForPhase(page, 'persisted-pass')
    expect(persisted.passed).toBe(true)
    expect(persisted.checks.every(check => check.passed)).toBe(true)
    await miniProgram.screenshot({ path: path.join(output, 'persisted.png') })
    expect(runtimeFailures).toEqual([])

    await writeFile(path.join(output, 'report.json'), `${JSON.stringify({
      schemaVersion: 1,
      commit,
      target: runtimeProvider,
      passed: true,
      checks: { first, persisted, runtimeFailures },
      screenshots: { first: 'first.png', persisted: 'persisted.png' },
    }, null, 2)}\n`)
    await writeFile(path.join(output, 'runtime.log'), `${runtimeLogs.join('\n')}\n`)
  }
  catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    runtimeLog('acceptance-error', message)
    let acceptance: PageAcceptance | undefined
    try {
      acceptance = await page?.data('acceptance') as PageAcceptance | undefined
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
      target: runtimeProvider,
      passed: false,
      checks: { acceptance },
      error: message,
      screenshots: failureScreenshot ? { failure: failureScreenshot } : {},
    }, null, 2)}\n`)
    await writeFile(path.join(output, 'runtime.log'), `${runtimeLogs.join('\n')}\n`)
    throw error
  }
})

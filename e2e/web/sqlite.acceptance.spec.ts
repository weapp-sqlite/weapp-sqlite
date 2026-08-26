import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { acceptanceArtifactRoot } from '../../scripts/acceptance-paths'

interface PageAcceptance {
  readonly schemaVersion: 1
  readonly phase: string
  readonly passed: boolean
  readonly checks: readonly { readonly id: string, readonly passed: boolean, readonly detail: string }[]
}

async function readAcceptance(page: import('@playwright/test').Page): Promise<PageAcceptance> {
  const value = await page.locator('#acceptance-report').textContent()
  if (!value) {
    throw new Error('The Web acceptance page did not emit a report.')
  }
  return JSON.parse(value) as PageAcceptance
}

async function waitForPhase(page: import('@playwright/test').Page, expectedPhase: 'ready'): Promise<void>
async function waitForPhase(page: import('@playwright/test').Page, expectedPhase: string): Promise<PageAcceptance>
async function waitForPhase(
  page: import('@playwright/test').Page,
  expectedPhase: string,
): Promise<PageAcceptance | void> {
  const deadline = Date.now() + 30_000
  const status = page.locator('#acceptance-status')
  while (Date.now() < deadline) {
    const phase = (await status.textContent())?.trim()
    if (phase === expectedPhase) {
      return expectedPhase === 'ready' ? undefined : readAcceptance(page)
    }
    if (phase === 'failed' || phase === 'unsupported') {
      const acceptance = await readAcceptance(page)
      throw new Error(`Web acceptance entered ${acceptance.phase}: ${JSON.stringify(acceptance)}`)
    }
    await page.waitForTimeout(100)
  }
  const acceptance = await readAcceptance(page)
  throw new Error(`Timed out waiting for Web acceptance phase ${expectedPhase}: ${JSON.stringify(acceptance)}`)
}

test('persists SQLite across a production Web reload', async ({ page }) => {
  const consoleErrors: string[] = []
  const runtimeErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('requestfailed', request => runtimeErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`))

  const { commit, root } = await acceptanceArtifactRoot()
  const output = path.join(root, 'web')
  await mkdir(output, { recursive: true })

  await page.goto('/')
  await page.locator('#reset-acceptance').click()
  await waitForPhase(page, 'ready')
  await page.locator('#run-acceptance').click()
  const first = await waitForPhase(page, 'first-pass')
  expect(first.passed).toBe(true)
  expect(first.checks.every(check => check.passed)).toBe(true)
  await page.screenshot({ path: path.join(output, 'first.png'), fullPage: true })

  await page.reload()
  await waitForPhase(page, 'ready')
  await page.locator('#verify-acceptance').click()
  const persisted = await waitForPhase(page, 'persisted-pass')
  expect(persisted.passed).toBe(true)
  expect(persisted.checks.every(check => check.passed)).toBe(true)
  await page.screenshot({ path: path.join(output, 'persisted.png'), fullPage: true })

  expect(consoleErrors).toEqual([])
  expect(runtimeErrors).toEqual([])
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify({
    schemaVersion: 1,
    commit,
    target: 'web',
    passed: true,
    checks: { first, persisted, consoleErrors, runtimeErrors },
    screenshots: { first: 'first.png', persisted: 'persisted.png' },
  }, null, 2)}\n`)
})

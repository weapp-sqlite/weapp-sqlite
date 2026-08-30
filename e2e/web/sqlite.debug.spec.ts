import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { acceptanceArtifactRoot } from '../../scripts/acceptance-paths'

test('manages SQLite through the generated data workspace', async ({ page }) => {
  const errors: string[] = []
  const { commit, root } = await acceptanceArtifactRoot()
  const output = path.join(root, 'web-debug')
  await mkdir(output, { recursive: true })
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(globalThis, 'showOpenFilePicker', { configurable: true, value: undefined })
  })
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text())
    }
  })
  page.on('pageerror', error => errors.push(error.message))

  await page.goto('/')
  await page.locator('#reset-acceptance').click()
  await expect(page.locator('#acceptance-status')).toHaveText('ready')
  await page.locator('#run-acceptance').click()
  await expect(page.locator('#acceptance-status')).toHaveText('first-pass')

  await page.goto('/__weapp_sqlite_debug/index/index')
  await expect(page.locator('#sqlite-workspace')).toBeVisible()
  await expect(page.locator('#debug-runtime')).toContainText('weapp-sqlite-acceptance-v1')
  await expect(page.locator('#debug-table-notes')).toBeVisible()
  await expect(page.locator('#debug-data-grid')).toContainText('SQLite works across frameworks')

  await page.locator('#debug-tab-sql').click()
  const editor = page.locator('#debug-sql-editor textarea')
  await editor.fill('SELECT count(*) AS total FROM notes')
  await page.locator('#debug-run-query').click()
  await expect(page.locator('#debug-result')).toContainText('total')

  await editor.fill('INSERT INTO notes (body) VALUES (\'workspace-write\')')
  await page.locator('#debug-run-write').click()
  await expect(page.locator('#debug-confirm-dialog')).toBeVisible()
  await page.locator('#debug-confirm-action').click()
  await page.locator('#debug-tab-data').click()
  await page.locator('#debug-search input').fill('workspace-write')
  await page.locator('#debug-search input').press('Enter')
  await expect(page.locator('#debug-data-grid')).toContainText('workspace-write')

  await page.locator('#debug-insert-row').click()
  await expect(page.locator('#debug-row-editor')).toBeVisible()
  await page.locator('#debug-row-editor [data-index="1"] input').fill('ui-row')
  await page.locator('#debug-save-row').click()
  await page.locator('#debug-search input').fill('ui-row')
  await page.locator('#debug-search input').press('Enter')
  await expect(page.locator('#debug-data-grid')).toContainText('ui-row')
  await page.locator('#debug-edit-row-0').click()
  await page.locator('#debug-row-editor [data-index="1"] input').fill('ui-row-edited')
  await page.locator('#debug-save-row').click()
  await expect(page.locator('#debug-data-grid')).toContainText('ui-row-edited')
  await page.locator('#debug-select-row-0').click()
  await page.locator('#debug-delete-rows').click()
  await page.locator('#debug-confirm-input input').fill('notes')
  await page.locator('#debug-confirm-action').click()
  await expect(page.locator('#debug-data-grid')).not.toContainText('ui-row-edited')
  await page.locator('#debug-undo').click()
  await expect(page.locator('#debug-data-grid')).toContainText('ui-row-edited')
  await page.locator('#debug-search input').fill('')
  await page.locator('#debug-search input').press('Enter')

  await page.locator('#debug-new-table input').fill('audit_logs')
  await page.locator('#debug-new-table-column input').fill('message')
  await page.locator('#debug-create-table').click()
  await expect(page.locator('#debug-table-audit_logs')).toBeVisible()
  await page.locator('#debug-undo').click()
  await expect(page.locator('#debug-table-audit_logs')).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#debug-mobile-table-notes').click()
  await page.locator('#debug-insert-row').click()
  await expect(page.locator('#debug-row-editor')).toBeVisible()
  await expect(page.locator('#debug-row-editor')).toHaveCSS('position', 'fixed')
  await page.locator('#debug-close-editor').click()
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.screenshot({ path: path.join(output, 'workspace.png'), fullPage: true })

  const sqliteDownload = page.waitForEvent('download')
  await page.locator('#debug-export-database').click()
  const sqlite = await sqliteDownload
  const sqlitePath = path.join(output, 'workspace.sqlite')
  await sqlite.saveAs(sqlitePath)
  expect((await readFile(sqlitePath)).subarray(0, 16).toString()).toBe('SQLite format 3\0')

  const jsonDownload = page.waitForEvent('download')
  await page.locator('[data-format="json"]').click()
  const json = await jsonDownload
  const jsonPath = path.join(output, 'notes.json')
  await json.saveAs(jsonPath)
  const jsonDocument = JSON.parse(await readFile(jsonPath, 'utf8')) as { schemaVersion: number, rows: unknown[] }
  expect(jsonDocument.schemaVersion).toBe(1)
  expect(jsonDocument.rows.length).toBeGreaterThan(0)

  const csvDownload = page.waitForEvent('download')
  await page.locator('[data-format="csv"]').click()
  const csv = await csvDownload
  const csvPath = path.join(output, 'notes.csv')
  await csv.saveAs(csvPath)
  expect((await readFile(csvPath)).subarray(0, 3)).toEqual(Uint8Array.from([0xEF, 0xBB, 0xBF]))

  const chooser = page.waitForEvent('filechooser')
  await page.locator('#debug-import-file').click()
  await (await chooser).setFiles(jsonPath)
  await expect(page.locator('#debug-import-preview')).toContainText('导入预览')
  await page.locator('#debug-import-mode-replace').click()
  const importConfirmation = page.getByRole('textbox', { name: '输入表名确认替换' })
  await expect(importConfirmation).toHaveValue('')
  await importConfirmation.fill('notes')
  await page.locator('#debug-run-import').click()
  await expect(page.locator('#debug-import-preview')).toBeHidden()

  await page.reload()
  await expect(page.locator('#debug-table-notes')).toBeVisible()
  await page.locator('#debug-search input').fill('workspace-write')
  await page.locator('#debug-search input').press('Enter')
  await expect(page.locator('#debug-data-grid')).toContainText('workspace-write')
  await page.screenshot({ path: path.join(output, 'persisted.png'), fullPage: true })
  expect(errors).toEqual([])
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify({
    schemaVersion: 2,
    commit,
    target: 'web-debug-workspace',
    passed: true,
    supportEvidence: true,
    checks: {
      sqliteMagic: true,
      jsonRows: jsonDocument.rows.length,
      csvBom: true,
      persistence: true,
      runtimeFailures: errors,
    },
    artifacts: { database: 'workspace.sqlite', tables: ['notes.csv', 'notes.json'] },
    screenshots: { first: 'workspace.png', persisted: 'persisted.png' },
  }, null, 2)}\n`)
})

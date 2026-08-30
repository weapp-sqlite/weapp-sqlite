import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'

test('previews, queries, writes, exports, and imports SQLite', async ({ page }, testInfo) => {
  const errors: string[] = []
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

  await page.locator('#debug-refresh').click()
  await expect(page.locator('#debug-tables')).toContainText('notes')
  await expect(page.locator('#debug-schema')).toContainText('body')
  await expect(page.locator('#debug-data')).toContainText('SQLite works across frameworks')

  const editor = page.getByRole('textbox')
  await editor.fill('SELECT count(*) AS total FROM notes')
  await page.locator('#debug-query').click()
  await expect(page.locator('#debug-result')).toContainText('total')

  await editor.fill('INSERT INTO notes (body) VALUES (\'debug-panel-write\')')
  page.once('dialog', dialog => dialog.accept())
  await page.locator('#debug-write').click()
  await expect(page.locator('#debug-data')).toContainText('debug-panel-write')

  await editor.fill('WITH RECURSIVE seq(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM seq WHERE value < 55) INSERT INTO notes (body) SELECT \'page-row-\' || value FROM seq')
  page.once('dialog', dialog => dialog.accept())
  await page.locator('#debug-write').click()
  await expect(page.locator('#debug-page-next')).toBeEnabled()
  await page.locator('#debug-page-next').click()
  await expect(page.locator('#debug-data')).toContainText('page-row-')
  await expect(page.locator('#debug-page-previous')).toBeEnabled()

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#debug-export').click()
  const download = await downloadPromise
  const exportPath = path.join(testInfo.outputDir, 'debug-export.sqlite')
  await download.saveAs(exportPath)
  expect((await readFile(exportPath)).subarray(0, 16).toString()).toBe('SQLite format 3\0')

  const fileInput = page.locator('#debug-import input[type="file"]')
  await fileInput.setInputFiles(exportPath)
  await expect(page.locator('#debug-result')).toContainText('sha256')
  await page.reload()
  await page.locator('#debug-refresh').click()
  await expect(page.locator('#debug-data')).toContainText('debug-panel-write')
  expect(errors).toEqual([])
})

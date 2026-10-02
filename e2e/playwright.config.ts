import path from 'node:path'
import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env['ACCEPTANCE_WEB_PORT'] ?? 4173)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './web',
  testMatch: 'sqlite.acceptance.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `ACCEPTANCE_WEB_PORT=${port} pnpm exec tsx scripts/serve-acceptance-web.ts`,
    cwd: path.resolve(import.meta.dirname, '..'),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})

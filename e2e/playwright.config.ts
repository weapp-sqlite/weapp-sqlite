import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './web',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec tsx scripts/serve-acceptance-web.ts',
    cwd: path.resolve(import.meta.dirname, '..'),
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})

import { readFile } from 'node:fs/promises'

describe('weapp-vite multiPlatform demo', () => {
  it('declares all supported single-target builds', async () => {
    const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
    expect(config).toContain('multiPlatform')
    for (const platform of ['weapp', 'alipay', 'tt', 'swan', 'jd', 'xhs']) {
      expect(config).toContain(`'${platform}'`)
    }
  })

  it('wires the page to the injected SQLite service', async () => {
    const page = await readFile(new URL('../src/pages/index/index.ts', import.meta.url), 'utf8')
    expect(page).toContain('runPlatformSqliteAcceptance')
    expect(page).toContain('verifyPlatformSqliteAcceptance')
    expect(page).toContain('resetPlatformSqliteAcceptance')
  })

  it('uses one SQLite initialization path without host globals or platform branches', async () => {
    const service = await readFile(new URL('../src/sqlite.ts', import.meta.url), 'utf8')
    expect(service).toContain('from \'@weapp-sqlite/weapp-vite/runtime\'')
    expect(service).toContain('openSqlite({')
    expect(service).not.toContain('import.meta.env.PLATFORM')
    expect(service).not.toContain('WXWebAssembly')
    expect(service).not.toMatch(/\b(?:wx|my|tt|swan|jd|xhs)\b/)
  })
})

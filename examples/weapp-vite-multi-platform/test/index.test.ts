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

  it('never silently enables unverified mini-program hosts', async () => {
    const service = await readFile(new URL('../../../packages/miniprogram/src/index.ts', import.meta.url), 'utf8')
    expect(service).toContain('weapp: weappHostAdapter')
    expect(service).toContain('MINIPROGRAM_SQLITE_PLATFORM_UNSUPPORTED')
  })
})

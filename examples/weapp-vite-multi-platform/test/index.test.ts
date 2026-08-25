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
    expect(page).toContain('runPlatformSqliteDemo')
    expect(page).toContain('runDemo')
  })
})

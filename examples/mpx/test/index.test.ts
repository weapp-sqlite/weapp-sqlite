import { readFile } from 'node:fs/promises'

describe('MPX demo', () => {
  it('keeps SQLite integration in the MPX page boundary', async () => {
    const source = await readFile(new URL('../src/pages/index.mpx', import.meta.url), 'utf8')
    expect(source).toContain('from \'@weapp-sqlite/demo-shared\'')
    expect(source).toContain('wx?.getStorage')
    expect(source).toContain('runSqliteDemo')
  })
})

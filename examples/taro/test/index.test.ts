import { readFile } from 'node:fs/promises'

describe('Taro demo', () => {
  it('uses Taro storage APIs at the framework boundary', async () => {
    const source = await readFile(new URL('../src/pages/index/index.tsx', import.meta.url), 'utf8')
    expect(source).toContain('from \'@tarojs/taro\'')
    expect(source).toContain('Taro.getStorage')
    expect(source).toContain('runSqliteDemo')
  })
})

import { readFile } from 'node:fs/promises'

describe('uni-app demo', () => {
  it('uses uni storage APIs at the framework boundary', async () => {
    const source = await readFile(new URL('../src/pages/index/index.vue', import.meta.url), 'utf8')
    const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
    expect(app).toContain('@dcloudio/uni-app')
    expect(source).toContain('uni.getStorage')
    expect(source).toContain('runSqliteDemo')
  })
})

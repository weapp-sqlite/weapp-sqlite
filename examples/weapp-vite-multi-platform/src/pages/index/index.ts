import { runPlatformSqliteDemo } from '../../sqlite'

Page({
  data: {
    platform: import.meta.env.PLATFORM,
    status: 'ready',
    result: '点击按钮运行 SQLite migration + transaction',
  },
  async runDemo() {
    this.setData({ status: 'running' })
    try {
      const result = await runPlatformSqliteDemo()
      this.setData({ status: 'ready', result: JSON.stringify(result.rows) })
    }
    catch (error) {
      this.setData({ status: 'error', result: error instanceof Error ? error.message : String(error) })
    }
  },
})

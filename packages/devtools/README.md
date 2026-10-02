# @weapp-sqlite/devtools

连接 Web 与小程序运行时 SQLite 数据库的开发工具。它通过 Devframe 提供实时数据库列表、SQL 查询、表数据编辑、导入导出、迁移诊断和外键完整性检查，适合在开发期检查实际宿主中的数据。

```bash
pnpm add -D @weapp-sqlite/devtools
```

运行时桥接由应用侧注册，独立宿主可使用 `startSqliteDevtoolsServer()`；数据库操作仍由 `@weapp-sqlite/debug` 控制器执行，并遵循只读会话和显式写入权限。

在 `weapp-vite` 项目中开启独立面板：

```ts
// vite.config.ts
import { weappSqlite } from '@weapp-sqlite/weapp-vite'

export default {
  plugins: [weappSqlite({
    debug: {
      enabled: true,
      devtools: true,
    },
  })],
}
```

插件在开发服务中复用同一个 Devframe 宿主。`watch` 重建不会重复监听端口；开发服务关闭时会释放面板连接。多个面板各自持有调试租约，关闭一个面板不会释放其他面板仍在使用的控制器。生产构建关闭 `debug` 或 `devtools` 后不会注入面板桥接代码。

需要独立启动面板时，使用返回的认证 URL，并把 `close()` 绑定到开发服务退出：

```ts
import { startSqliteDevtoolsServer } from '@weapp-sqlite/devtools'

const server = await startSqliteDevtoolsServer({ allowWrite: true })
console.log(`Open SQLite Workbench: ${server.url}`)

// watcher.close / process "exit" 时调用
await server.close()
```

面板先选择运行实例，再选择数据库。查询、编辑、执行计划、查询性能诊断、迁移/外键诊断、历史、结构操作和导入导出都通过当前运行时的真实连接完成；性能诊断只运行绑定参数的 `EXPLAIN QUERY PLAN`，不会执行原 SQL，并会标出临时 B-tree 用于排序、分组或去重；数据表优先使用稳定主键/rowid 游标翻页，深页不会重复扫描前置行，视图仍兼容 offset 翻页；外键 schema mismatch 会在诊断页按表显示结构错误；断线中的写操作不会自动重放。`connectDevtoolsClient()` 适合已有 Devframe 宿主嵌入自定义面板。

详细接入方式见 [调试工作台](https://sqlite.weapp.dev/docs/debug-workbench) 和 [weapp-vite API](https://sqlite.weapp.dev/docs/api/weapp-vite)。

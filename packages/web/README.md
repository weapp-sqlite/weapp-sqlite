# @weapp-sqlite/web

面向浏览器的 SQLite WASM 持久化 adapter，使用 IndexedDB 保存数据库二进制快照，并提供开发期文件导入导出能力。

weapp-vite 项目通常只需安装 [`@weapp-sqlite/weapp-vite`](https://www.npmjs.com/package/@weapp-sqlite/weapp-vite)；本包适合独立 Web 集成或自定义 adapter。

```bash
pnpm add @weapp-sqlite/web @weapp-sqlite/wasm
```

```ts
import { createIndexedDbSqliteWasmStorage } from '@weapp-sqlite/web'

const storage = createIndexedDbSqliteWasmStorage({
  databaseName: 'app.sqlite',
})
```

默认 IndexedDB 数据库名为 `weapp-sqlite`，object store 为 `databases`。IndexedDB 不可用时会抛出 `WEB_SQLITE_INDEXEDDB_UNAVAILABLE`，不会静默回退到内存数据库。

详见 [Web API](https://sqlite.icebreaker.top/docs/api/web) 和 [调试工作台](https://sqlite.icebreaker.top/docs/debug-workbench)。

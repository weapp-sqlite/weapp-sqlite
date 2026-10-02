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

存储在首次操作时打开 IndexedDB，并复用进行中的连接请求。打开失败后，下一次操作可以重试。收到其他连接发起的升级或删除请求时，adapter 会释放连接，已有事务仍等待完成；后续操作重新打开当前数据库版本。已放弃请求的迟到连接会立即关闭，避免阻塞后续升级或删除。读取、保存和删除都等待 IndexedDB 事务结束后再返回。

详见 [Web API](https://sqlite.weapp.dev/docs/api/web) 和 [调试工作台](https://sqlite.weapp.dev/docs/debug-workbench)。

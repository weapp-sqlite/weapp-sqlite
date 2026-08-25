# weapp-sqlite

一个面向小程序与 Web 宿主的可插拔 SQLite driver workspace。

当前实现刻意分成两层：

- `@weapp-sqlite/core`：定义异步连接、查询、事务和迁移协议，不依赖具体 SQLite 引擎。
- `@weapp-sqlite/wasm`：把可注入的 SQLite WASM 引擎（例如 `sql.js`）接到 core，并通过存储回调持久化数据库文件。

这不是把所有宿主都伪装成同一种原生数据库 API。微信小程序、Web 和其他小程序平台可以分别提供 `SqliteWasmStorage` 或原生 adapter；没有能力的平台应明确报告不支持。

## 快速开始

安装 WASM 引擎和 adapter：

```bash
pnpm add @weapp-sqlite/wasm sql.js
```

```ts
import { openSqliteWasmDatabase } from '@weapp-sqlite/wasm'
import initSqlJs from 'sql.js'

const database = await openSqliteWasmDatabase(
  options => initSqlJs({ locateFile: options?.locateFile }),
  'app.db',
  {
    locateFile: file => `/assets/${file}`,
    storage: {
      async load(name) {
        // 从 IndexedDB、OPFS 或 wx.getFileSystemManager() 读取 Uint8Array。
        return undefined
      },
      async save(name, data) {
        // 将导出的 SQLite 文件写回宿主持久化层。
        void name
        void data
      },
    },
  },
)

await database.exec('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
await database.exec('INSERT INTO notes (body) VALUES (?)', ['hello'])
const result = await database.query<{ id: number, body: string }>('SELECT id, body FROM notes')
await database.close()
```

所有数据库操作都是异步的。事务会串行执行，并在回调成功后提交；回调抛错时自动回滚。WASM 引擎和宿主存储由调用方注入，避免把某个平台的文件 API 固定到核心包。

## 开发

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm tsd
pnpm test
```

当前测试使用 `sql.js` 验证 WASM adapter 的真实 SQL 链路；小程序真机 adapter 和 IndexedDB/OPFS 存储仍应在各自宿主中单独验收。

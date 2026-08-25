# weapp-sqlite

一个面向小程序与 Web 宿主的可插拔 SQLite driver workspace。

文档站：[`sqlite.icebreaker.top`](https://sqlite.icebreaker.top)。文档源码位于 `apps/docs`，使用 Fumadocs 构建为纯静态站点，并由 Cloudflare Worker 的 Static Assets 托管。

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

文档站本地开发与部署：

```bash
pnpm --filter @weapp-sqlite/docs dev
pnpm --filter @weapp-sqlite/docs build
pnpm --filter @weapp-sqlite/docs run deploy:dry
pnpm --filter @weapp-sqlite/docs run deploy
```

当前测试使用 `sql.js` 验证 WASM adapter 的真实 SQL 链路；小程序真机 adapter 和 IndexedDB/OPFS 存储仍应在各自宿主中单独验收。

## 多端 demo

`examples/` 提供同一个 migration + transaction 场景的四套实现，共享层只负责 SQLite 业务流程，各框架只负责宿主存储 API：

- `examples/weapp-vite-multi-platform`：使用 `weapp.multiPlatform`，支持 `weapp`、`alipay`、`tt`、`swan`、`jd`、`xhs`，并提供 Web 构建。
- `examples/taro`：Taro 4 + React。
- `examples/uni-app`：uni-app Vue 3。
- `examples/mpx`：MPX + Webpack 5。

安装依赖后，可以分别运行 wiring 测试、类型检查和构建：

```bash
pnpm install

pnpm --filter @weapp-sqlite/demo-shared test
pnpm --filter @weapp-sqlite/demo-shared typecheck

pnpm --filter weapp-sqlite-demo-weapp-vite test
pnpm --filter weapp-sqlite-demo-weapp-vite typecheck
pnpm --filter weapp-sqlite-demo-weapp-vite build:weapp
pnpm --filter weapp-sqlite-demo-weapp-vite build:alipay
pnpm --filter weapp-sqlite-demo-weapp-vite build:tt
pnpm --filter weapp-sqlite-demo-weapp-vite build:swan
pnpm --filter weapp-sqlite-demo-weapp-vite build:jd
pnpm --filter weapp-sqlite-demo-weapp-vite build:xhs
pnpm --filter weapp-sqlite-demo-weapp-vite build:web

pnpm --filter weapp-sqlite-demo-taro test
pnpm --filter weapp-sqlite-demo-taro typecheck
pnpm --filter weapp-sqlite-demo-taro build:weapp

pnpm --filter weapp-sqlite-demo-uni-app test
pnpm --filter weapp-sqlite-demo-uni-app typecheck
pnpm --filter weapp-sqlite-demo-uni-app build:weapp

pnpm --filter weapp-sqlite-demo-mpx test
pnpm --filter weapp-sqlite-demo-mpx typecheck
pnpm --filter weapp-sqlite-demo-mpx build:weapp
```

真实宿主运行前，需要把 `sql.js` 发布包中的 `dist/sql-wasm.wasm` 作为静态资源放到目标项目的 `/assets/sql-wasm.wasm`。demo 中的 `locateFile` 已统一指向该路径；数据库文件则通过各框架的 storage API 持久化。构建完成后，将对应产物目录导入开发者工具：weapp-vite 使用 `dist/<platform>`，Taro 使用 `dist`，uni-app 使用 `dist/build/mp-weixin`，MPX 使用 `dist`。Web 目标直接运行 `examples/weapp-vite-multi-platform/dist/web` 的静态服务即可。

开发者工具和真机验证仍需在各平台本地完成，重点验收“运行 SQLite”按钮、迁移版本 `[1, 2]`、查询结果和重新进入页面后的持久化状态。Taro、uni-app、MPX 的构建测试只验证编译链和宿主边界，不能替代对应平台开发者工具的运行时验证。

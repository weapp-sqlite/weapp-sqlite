# weapp-sqlite

一个面向小程序与 Web 宿主的可插拔 SQLite driver workspace。

文档站：[`sqlite.icebreaker.top`](https://sqlite.icebreaker.top)。文档源码位于 `apps/docs`，使用 Fumadocs 构建为纯静态站点，并由 Cloudflare Worker 的 Static Assets 托管。

当前实现刻意分成五个边界：

- `@weapp-sqlite/core`：定义异步连接、查询、事务和迁移协议，不依赖具体 SQLite 引擎。
- `@weapp-sqlite/wasm`：把可注入的 SQLite WASM 引擎（例如 `sql.js`）接到 core，并通过存储回调持久化数据库文件。
- `@weapp-sqlite/web`：使用 IndexedDB 持久化 Web 二进制数据库，不回退到内存。
- `@weapp-sqlite/miniprogram`：通用小程序宿主协议，首期内置微信文件系统 driver 和 `WXWebAssembly` sql.js 初始化桥接。
- `@weapp-sqlite/debug`：开发期表结构、分页数据、受控 SQL 和 SQLite 快照管理控制器。

这不是把所有宿主都伪装成同一种原生数据库 API。支付宝、抖音、百度、京东和小红书当前可以构建，但没有内置 driver，运行时会明确报告 `unsupported`，不宣称已经支持。

## 快速开始

Web 安装 WASM 引擎和 IndexedDB adapter：

```bash
pnpm add @weapp-sqlite/wasm @weapp-sqlite/web sql.js
```

```ts
import { openSqliteWasmDatabase } from '@weapp-sqlite/wasm'
import { createIndexedDbSqliteWasmStorage } from '@weapp-sqlite/web'
import initSqlJs from 'sql.js'

const database = await openSqliteWasmDatabase(
  options => initSqlJs({ locateFile: options?.locateFile }),
  'app.db',
  {
    locateFile: file => `/assets/${file}`,
    storage: createIndexedDbSqliteWasmStorage(),
  },
)

await database.exec('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
await database.exec('INSERT INTO notes (body) VALUES (?)', ['hello'])
const result = await database.query<{ id: number, body: string }>('SELECT id, body FROM notes')
await database.close()
```

所有数据库操作都是异步的。事务会串行执行，并在回调成功后提交；回调抛错时自动回滚。微信接入使用 `@weapp-sqlite/miniprogram`，显式传入 `platform: 'weapp'`、顶层 `wx` runtime 和 `WXWebAssembly`。

开发调试面板通过 `WEAPP_SQLITE_DEBUG=1` 编译开关启用，支持表预览、只读查询、显式确认写 SQL、导出/导入/重置。默认生产构建不包含调试入口；调试控制器会在导出前调用 `database.flush()`，并拒绝文件系统相关 SQL。

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

当前测试使用 `sql.js` 验证 WASM adapter 的真实 SQL 链路，并使用 Playwright 对 Web 生产产物执行 IndexedDB 持久化验收。微信支持仍必须经过真实 DevTools 与 iOS/Android 真机门禁。

## 多端 demo

`examples/` 提供同一个 migration + transaction 场景的四套实现，共享层只负责 SQLite 业务流程，各框架只负责宿主存储 API：

- `examples/weapp-vite-multi-platform`：正式验收应用，可构建 `weapp`、`alipay`、`tt`、`swan`、`jd`、`xhs` 和 Web；Web 与真实 DevTools 自动验收已通过，微信真机仍需完成 iOS/Android 门禁。
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

weapp-vite 验收应用会从 `sql.js` 发布包向忽略提交的生成资源目录确定性复制当前目标所需的单个 WASM 文件。Web 使用 `sql-wasm-browser.wasm` 静态 URL 和 IndexedDB；微信通过 `WXWebAssembly.instantiate()` 加载代码包中的 `sql-wasm.wasm`，并把数据库文件保存到 `USER_DATA_PATH`。

完整门禁命令为 `pnpm acceptance:build`、`pnpm acceptance:web`、`pnpm acceptance:debug:web`、`pnpm acceptance:devtools:doctor`、`pnpm acceptance:devtools`、`pnpm acceptance:debug:devtools`、`pnpm acceptance:mobile:prepare` 和 `pnpm acceptance:verify`。只有 Web、真实 DevTools、iOS 下限/最新、Android 下限/最新六份当前 commit 证据全部通过，才可发布微信多端支持结论。

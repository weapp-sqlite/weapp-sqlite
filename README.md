# weapp-sqlite

一个面向小程序与 Web 宿主的可插拔 SQLite driver workspace。

文档站：[`sqlite.icebreaker.top`](https://sqlite.icebreaker.top)。文档源码位于 `apps/docs`，使用 Fumadocs 构建为纯静态站点，并由 Cloudflare Worker 的 Static Assets 托管。

如果你是第一次使用，建议先阅读[快速开始](https://sqlite.icebreaker.top/docs/getting-started)。本项目适合把数据保存在用户设备上，不是远程数据库或线上运营后台。

## 你需要准备什么

- Node.js 22.12+
- pnpm 11（使用 npm 时把 `pnpm add` 换成 `npm install`）
- 一个可以正常运行的 weapp-vite 项目
- 验收微信时登录微信开发者工具

当前实现刻意分成六个边界：

- `@weapp-sqlite/core`：定义异步连接、查询、事务和迁移协议，不依赖具体 SQLite 引擎。
- `@weapp-sqlite/wasm`：把可注入的 SQLite WASM 引擎（例如 `sql.js`）接到 core，并通过存储回调持久化数据库文件。
- `@weapp-sqlite/web`：使用 IndexedDB 持久化 Web 二进制数据库，不回退到内存。
- `@weapp-sqlite/miniprogram`：六个小程序目标共用的文件系统、能力探测和 WebAssembly 实例化协议。
- `@weapp-sqlite/debug`：开发期表结构、分页数据、受控 SQL 和 SQLite 快照管理控制器。
- `@weapp-sqlite/weapp-vite`：构建期选择目标 adapter 和 WASM，运行时统一为 `openSqlite()`。

业务代码可以保持一致，但各目标仍然是独立产物。插件只注入当前目标 runtime；支付宝、抖音、百度、京东和小红书虽已有可探测 adapter，在完成官方 DevTools 与 iOS/Android 宿主验收前仍不宣称正式支持。

## 快速开始

weapp-vite 项目安装统一集成包：

```bash
pnpm add @weapp-sqlite/weapp-vite
```

```ts
// vite.config.ts
import { weappSqlite } from '@weapp-sqlite/weapp-vite'
import { defineConfig } from 'weapp-vite'

export default defineConfig({ plugins: [weappSqlite()] })
```

```ts
import { openSqlite } from '@weapp-sqlite/weapp-vite/runtime'

const database = await openSqlite({ name: 'app.sqlite', migrations })

await database.exec('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
await database.exec('INSERT INTO notes (body) VALUES (?)', ['hello'])
const result = await database.query<{ id: number, body: string }>('SELECT id, body FROM notes')
await database.close()
```

所有数据库操作都是异步的。事务会串行执行，并在回调成功后提交；回调抛错时自动回滚。同名并发打开会合并，adapter 或迁移配置冲突时返回 `SQLITE_OPEN_OPTIONS_CONFLICT`，能力缺失时不会退回内存。

建议先掌握四个动作：定义迁移、`openSqlite()`、使用绑定参数读写、`flush()`/`close()`。完整解释见[核心概念](https://sqlite.icebreaker.top/docs/concepts)。

开发数据工作台通过 `WEAPP_SQLITE_DEBUG=1` 编译开关启用，支持筛选、排序、分页、行 CRUD、表/列/索引管理、受控 SQL、单步撤销，以及 SQLite/CSV/JSON 导入导出。默认生产构建不生成工作台路由，也不打包写 SQL、codec 或宿主文件 API。详细操作见[调试工作台](https://sqlite.icebreaker.top/docs/debug-workbench)。

```ts
weappSqlite({
  debug: {
    enabled: process.env.WEAPP_SQLITE_DEBUG === '1',
    page: {
      route: '__weapp_sqlite_debug/index/index',
      configFile: './src/sqlite-debug.config.ts',
    },
  },
})
```

```ts
// src/sqlite-debug.config.ts
import { defineSqliteDebugWorkspace } from '@weapp-sqlite/weapp-vite/debug'
import { migrations } from './sqlite'

export default defineSqliteDebugWorkspace({
  databaseName: 'app.sqlite',
  migrations,
})
```

生成页使用 weapp-vite 自动路由注册独立分包。采用静态 `app.json` 的项目需升级为 `app.json.ts`，从 `weapp-vite/auto-routes` 写入 `subPackages`；生产构建得到空数组，调试构建才包含工作台。

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

`weappSqlite()` 会确定性发射当前目标所需的单个 WASM 文件。Web 使用 `sql-wasm-browser.wasm` 和 IndexedDB；微信通过 `WXWebAssembly.instantiate()` 加载 `sql-wasm.wasm`。其余五个平台保持可构建，运行或文件交付能力未通过真实宿主门禁时返回结构化 `unsupported`，不得视为正式支持。

完整门禁命令为 `pnpm acceptance:build`、`pnpm acceptance:web`、`pnpm acceptance:debug:web`、`pnpm acceptance:devtools:doctor`、`pnpm acceptance:devtools`、`pnpm acceptance:debug:devtools`、`pnpm acceptance:mobile:prepare` 和 `pnpm acceptance:verify`。汇总器要求 Web，以及六个平台各自的官方 DevTools、当前稳定 iOS 和 Android 宿主报告；缺少任一当前 commit 证据的平台不得标记正式支持。

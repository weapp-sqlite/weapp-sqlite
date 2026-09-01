# @weapp-sqlite/weapp-vite

weapp-vite 的全端统一 SQLite 构建插件与运行时。推荐业务项目只依赖这个包，使用一套 `openSqlite()` 代码运行在 Web 和小程序目标中。

```bash
pnpm add @weapp-sqlite/weapp-vite
```

```ts
// vite.config.ts
import { weappSqlite } from '@weapp-sqlite/weapp-vite'
import { defineConfig } from 'weapp-vite'

export default defineConfig({
  plugins: [weappSqlite()],
})
```

默认使用 full 引擎并放在主包。微信项目推荐使用 lite 自动分包：

```ts
weappSqlite({
  wasm: {
    variant: 'lite',
    weappPackage: { mode: 'generated-subpackage' },
  },
})
```

自动分包默认 root 为 `__weapp_sqlite__`，要求 `app.json.ts` 接入 `weapp-vite/auto-routes`。静态 `app.json` 可使用 `{ mode: 'existing-subpackage', root: 'shared' }` 绑定已声明的普通分包；独立分包会被拒绝。`openSqlite()` 不变，lite 的 `getSqliteRuntimeInfo().engine` 为 `sql.js-wasm-lite`。

```ts
import { openSqlite } from '@weapp-sqlite/weapp-vite/runtime'

const database = await openSqlite({
  name: 'app.sqlite',
  migrations,
})
```

插件按当前单目标构建注入 runtime，并只发射所需 WASM。业务代码不需要引用 `wx`、`my`、`WXWebAssembly` 或资源路径。

开发期工作台：

```bash
WEAPP_SQLITE_DEBUG=1 pnpm build:web
```

```ts
weappSqlite({
  debug: {
    enabled: process.env.WEAPP_SQLITE_DEBUG === '1',
    page: { route: '__weapp_sqlite_debug/index/index', configFile: './src/sqlite-debug.config.ts' },
  },
})
```

Web、微信、支付宝、抖音、百度、京东和小红书使用相同业务 API，但仍分别执行单目标构建。插件只发射当前目标所需的 WASM，并在构建期注入对应 runtime。宿主能力不足时返回结构化 `SQLITE_RUNTIME_UNSUPPORTED`，不会回退到内存数据库。

兼容的 full adapter 从 `@weapp-sqlite/weapp-vite/adapter` 导入；需要注入引擎初始化器时使用 `@weapp-sqlite/weapp-vite/advanced`。调试控制器从 `@weapp-sqlite/weapp-vite/debug` 导入。平台正式支持结论仍以对应官方 DevTools、iOS 和 Android 宿主验收为准，`unsupported` 不会静默回退到内存数据库。

完整教程：[快速开始](https://sqlite.weapp.dev/docs/getting-started) · [核心概念](https://sqlite.weapp.dev/docs/concepts) · [调试工作台](https://sqlite.weapp.dev/docs/debug-workbench)

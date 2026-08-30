# @weapp-sqlite/weapp-vite

weapp-vite 的全端统一 SQLite 构建插件与运行时。

```bash
pnpm add @weapp-sqlite/weapp-vite sql.js
```

```ts
// vite.config.ts
import { weappSqlite } from '@weapp-sqlite/weapp-vite'
import { defineConfig } from 'weapp-vite'

export default defineConfig({
  plugins: [weappSqlite()],
})
```

```ts
import { openSqlite } from '@weapp-sqlite/weapp-vite/runtime'

const database = await openSqlite({
  name: 'app.sqlite',
  migrations,
})
```

Web、微信、支付宝、抖音、百度、京东和小红书使用相同业务 API，但仍分别执行单目标构建。插件只发射当前目标所需的 WASM，并在构建期注入对应 runtime。宿主能力不足时返回结构化 `SQLITE_RUNTIME_UNSUPPORTED`，不会回退到内存数据库。

高级 adapter 类型从 `@weapp-sqlite/weapp-vite/adapter` 导入；调试控制器从 `@weapp-sqlite/weapp-vite/debug` 导入。平台正式支持结论仍以对应官方 DevTools、iOS 和 Android 宿主验收为准。

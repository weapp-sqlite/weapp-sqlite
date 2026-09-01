# @weapp-sqlite/wasm

可注入 SQLite WASM 引擎和持久化回调的宿主无关 adapter。它连接 sql.js 一类的 WASM 引擎与 `@weapp-sqlite/core`，本身不选择存储宿主。

```bash
pnpm add @weapp-sqlite/wasm @weapp-sqlite/core
```

```ts
import { openSqliteWasmDatabase } from '@weapp-sqlite/wasm'

const database = await openSqliteWasmDatabase(
  initializer,
  'app.sqlite',
  {
    storage,
  },
)
```

`storage` 至少实现 `load(name)` 和 `save(name, bytes)`；连接的 `flush()` 会在写入后导出最新数据库快照。需要自定义资源路径时传入 `locateFile`。

本包不直接访问 IndexedDB、小程序文件系统或平台 runtime。Web 使用 `@weapp-sqlite/web`，小程序使用 `@weapp-sqlite/miniprogram`，weapp-vite 项目优先使用 `@weapp-sqlite/weapp-vite`。

通常不需要直接配置 WASM adapter：weapp-vite 会为当前目标自动选择资源。详见 [WASM API](https://sqlite.icebreaker.top/docs/api/wasm)。

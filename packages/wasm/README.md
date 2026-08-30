# @weapp-sqlite/wasm

可注入 SQLite WASM 引擎和持久化回调的宿主无关 adapter。

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

本包不直接访问 IndexedDB、小程序文件系统或平台 runtime。Web 使用 `@weapp-sqlite/web`，小程序使用 `@weapp-sqlite/miniprogram`，weapp-vite 项目优先使用 `@weapp-sqlite/weapp-vite`。

完整文档与支持矩阵见 [weapp-sqlite 仓库](https://github.com/weapp-sqlite/weapp-sqlite)。

# @weapp-sqlite/wasm

可注入 SQLite WASM 引擎和持久化回调的宿主无关 adapter。它连接 sql.js 一类的 WASM 引擎与 `@weapp-sqlite/core`，本身不选择存储宿主。

```bash
pnpm add @weapp-sqlite/wasm @weapp-sqlite/core @weapp-sqlite/sqljs
```

```ts
import initializer from '@weapp-sqlite/sqljs/full'
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

自定义引擎必须提供 `exportSnapshot(): Uint8Array`，复制主数据库时不得关闭或重建连接。官方原版 sql.js 的 `export()` 不满足这一要求；可迁移到 `@weapp-sqlite/sqljs/full` 或 `/lite`。初始化失败后可以重试。

内置引擎的 `execWithMetadata()` 使用 SQLite 原生只读信息判断写入，`query('INSERT … RETURNING …')` 也会持久化；普通 SELECT 不保存快照。自定义引擎缺少该可选接口时，adapter 将执行保守地视作写入。事务内不会提前持久化，提交后统一保存。

`bigint` 参数仅允许 JavaScript 安全整数范围，超出时抛出 `RangeError`，避免静默舍入。保存失败保留待保存状态，可重试 `flush()`；事务提交后的失败使用 core 的 `SqlitePersistenceError` 表示。完整迁移步骤见[升级指南](https://sqlite.weapp.dev/docs/upgrading)。

本包不直接访问 IndexedDB、小程序文件系统或平台 runtime。Web 使用 `@weapp-sqlite/web`，小程序使用 `@weapp-sqlite/miniprogram`，weapp-vite 项目优先使用 `@weapp-sqlite/weapp-vite`。

通常不需要直接配置 WASM adapter：weapp-vite 会为当前目标自动选择资源。详见 [WASM API](https://sqlite.weapp.dev/docs/api/wasm)。

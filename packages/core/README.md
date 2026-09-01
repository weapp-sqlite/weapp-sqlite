# @weapp-sqlite/core

宿主无关的异步 SQLite 协议、事务和迁移层。该包不依赖浏览器、小程序、Node 文件系统或 WASM API。

如果你只是要在 weapp-vite 项目中使用 SQLite，请安装 [`@weapp-sqlite/weapp-vite`](https://www.npmjs.com/package/@weapp-sqlite/weapp-vite)；本包适合实现自定义 driver 或理解底层协议。

```bash
pnpm add @weapp-sqlite/core
```

```ts
import { createSqliteDatabase, migrate } from '@weapp-sqlite/core'

const connection = await driver.open('app.sqlite')
const database = createSqliteDatabase('app.sqlite', connection)
await migrate(database, migrations)
```

`SqliteDatabase` 提供异步 `exec`、`query`、`transaction`、`flush` 和 `close`。事务回调抛错会自动回滚，迁移版本必须是正整数且唯一。

通常应用应直接使用对应宿主集成，例如 `@weapp-sqlite/weapp-vite`。只有实现自定义 driver 或复用迁移、事务协议时才需要直接依赖本包。

完整新手教程见 [快速开始](https://sqlite.weapp.dev/docs/getting-started)，协议说明见 [Core API](https://sqlite.weapp.dev/docs/api/core)。

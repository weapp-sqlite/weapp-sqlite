# @weapp-sqlite/core

宿主无关的异步 SQLite 协议、事务和迁移层。该包不依赖浏览器、小程序、Node 文件系统或 WASM API。

```bash
pnpm add @weapp-sqlite/core
```

```ts
import { createSqliteDatabase, migrate } from '@weapp-sqlite/core'

const connection = await driver.open('app.sqlite')
const database = createSqliteDatabase('app.sqlite', connection)
await migrate(database, migrations)
```

通常应用应直接使用对应宿主集成，例如 `@weapp-sqlite/weapp-vite`。只有实现自定义 driver 或复用迁移、事务协议时才需要直接依赖本包。

完整文档与支持矩阵见 [weapp-sqlite 仓库](https://github.com/weapp-sqlite/weapp-sqlite)。

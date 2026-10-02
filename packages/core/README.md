# @weapp-sqlite/core

宿主无关的异步 SQLite 协议、事务和迁移层。该包不依赖浏览器、小程序、Node 文件系统或 WASM API。

如果你只是要在 weapp-vite 项目中使用 SQLite，请安装 [`@weapp-sqlite/weapp-vite`](https://www.npmjs.com/package/@weapp-sqlite/weapp-vite)；本包适合实现自定义 driver 或理解底层协议。

```bash
pnpm add @weapp-sqlite/core
```

```ts
import { createSqliteDatabase, execMany, getMigrationStatus, migrate } from '@weapp-sqlite/core'

const connection = await driver.open('app.sqlite')
const database = createSqliteDatabase('app.sqlite', connection)
await migrate(database, migrations)
await execMany(database, 'INSERT INTO notes (body) VALUES (?)', [['第一条'], ['第二条']])
const status = await getMigrationStatus(database, migrations)
console.log(status.pending)
```

`SqliteDatabase` 提供异步 `exec`、`query`、`transaction`、`flush` 和 `close`。事务操作串行执行；回调抛错或任何内部操作失败都会回滚，即使回调捕获了该操作错误。回调结束后事务句柄失效，此前已启动的操作会先完成。活动事务期间再次调用 `database.transaction()` 会拒绝；事务内应使用传入的句柄。

`execMany(database, sql, parameterSets)` 在一个事务中执行全部参数集，按顺序返回逐条结果；传入事务句柄时复用外层事务。空批次返回 `[]`。任一执行失败会停止后续操作，批次随其所属事务回滚。

`getMigrationStatus(database, migrations = [])` 不创建迁移表，返回 `tablePresent`、`applied`、`pending`、`unknown` 和 `conflicts`。`pending` 仅包含版本和名称。同一数据库对象上的迁移与状态读取串行协调；迁移版本必须是正整数且唯一，已应用版本的名称冲突会在执行新迁移前报错。

事务提交后保存失败会抛出 `SqlitePersistenceError`，其 `committed === true` 且 `cause` 保留存储错误。若连接 adapter 保留待保存状态，应重试 `database.flush()`，不要重复执行事务；core 协议本身不替自定义连接保证这一点。回滚本身失败后，连接只允许关闭，必须重新打开后才能继续操作。

通常应用应直接使用对应宿主集成，例如 `@weapp-sqlite/weapp-vite`。只有实现自定义 driver 或复用迁移、事务协议时才需要直接依赖本包。

完整新手教程见 [快速开始](https://sqlite.weapp.dev/docs/getting-started)，协议说明见 [Core API](https://sqlite.weapp.dev/docs/api/core)。

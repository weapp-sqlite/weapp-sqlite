# weapp-sqlite

weapp-sqlite 的统一门面包，复用 `@weapp-sqlite/weapp-vite` 的构建插件与运行时。

```bash
npm install weapp-sqlite
```

```ts
import { weappSqlite } from 'weapp-sqlite'
import { execMany, getMigrationStatus, openSqlite } from 'weapp-sqlite/runtime'

const database = await openSqlite({ name: 'app.sqlite', migrations })
await execMany(database, 'INSERT INTO notes (body) VALUES (?)', [['第一条'], ['第二条']])
const status = await getMigrationStatus(database, migrations)
console.log(status.pending)
await database.close()
```

需要更细粒度控制时，可以直接安装 `@weapp-sqlite/*` 底层包。

runtime 同时导出 `SqlitePersistenceError`：事务已提交而快照保存失败时，检查 `committed` 并重试 `database.flush()`，不要重放业务事务。批量操作和迁移诊断详见 [Core API](https://sqlite.weapp.dev/docs/api/core)，自定义引擎迁移见[升级指南](https://sqlite.weapp.dev/docs/upgrading)。

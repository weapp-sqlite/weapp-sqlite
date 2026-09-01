# @weapp-sqlite/debug

宿主无关的 SQLite 数据调试控制器，提供表结构与分页预览、受控 SQL、CRUD、索引管理、CSV/JSON 导入导出和单步快照撤销。

这是开发期工具，不是线上数据库后台。生产构建不要打包它；weapp-vite 项目优先使用自动生成的数据工作台。

```bash
pnpm add -D @weapp-sqlite/debug
```

```ts
import { createSqliteDebugController } from '@weapp-sqlite/debug'

const controller = createSqliteDebugController({
  databaseName: 'app.sqlite',
  openDatabase,
  storage,
  enabled: true,
})
```

控制器只有在 `enabled: true` 时才执行操作。查询 SQL 默认只允许 `SELECT`、`EXPLAIN` 和安全 `PRAGMA`；写入、结构修改和导入必须显式传入 `allowWrite: true`，破坏性操作还需要完整表名确认和可用快照。

详见 [调试工作台](https://sqlite.weapp.dev/docs/debug-workbench) 和 [Debug API](https://sqlite.weapp.dev/docs/api/debug)。

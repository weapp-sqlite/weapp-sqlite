# @weapp-sqlite/debug

宿主无关的 SQLite 数据调试控制器，提供表结构与分页预览、受控 SQL、查询性能诊断、迁移与外键诊断、CRUD、索引管理、CSV/JSON 导入导出和单步快照撤销。

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
  migrations,
  enabled: true,
})
```

控制器只有在 `enabled: true` 时才执行操作。查询 SQL 默认只允许 `SELECT`、`WITH ... SELECT`、`EXPLAIN` 和安全 `PRAGMA`；包含数据修改语句的 CTE 仍按写操作拒绝。写入、结构修改和导入必须显式传入 `allowWrite: true`，破坏性操作还需要完整表名确认和可用快照。

`analyzeQuery()` 使用绑定参数生成 `EXPLAIN QUERY PLAN`，只返回计划和扫描/索引诊断，不执行原 SQL；临时 B-tree 会标明用于排序、分组或去重。详见 [调试工作台](https://sqlite.weapp.dev/docs/debug-workbench) 和 [Debug API](https://sqlite.weapp.dev/docs/api/debug)。

`getMigrationDiagnostics()` 对比配置中的 `migrations` 与历史表，报告待执行、未知版本和名称冲突；`getForeignKeyDiagnostics()` 读取外键约束、`PRAGMA foreign_keys` 和 `PRAGMA foreign_key_check`，报告约束违规。两项能力均为只读。

`readTable()` 会按数据库 revision 缓存当前筛选条件的总行数，翻页时避免重复执行 `COUNT(*)`；写入、快照替换或重置后自动失效。请求的 `offset` 超过最后一页时会回退到最后一个有效页，空表统一返回 `offset: 0`。返回的 `limit` 是应用调试上限约束后的实际页大小，面板会使用它计算翻页步长。为避免大表使用 offset 翻页时出现重复或跳过，未指定 `orderBy` 时会按可用 `rowid` 或完整主键排序；指定排序时会追加尚未出现的定位列作为升序 tie-breaker。视图和没有可靠定位符的对象不添加隐式排序。

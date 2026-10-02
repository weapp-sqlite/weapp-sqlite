# @weapp-sqlite/sqljs

`weapp-sqlite` 使用的 sql.js 引擎与 WASM 资源包。

```ts
import initSqlJs from '@weapp-sqlite/sqljs/full'
// 或 import initSqlJs from '@weapp-sqlite/sqljs/lite'
```

- `full` 基于官方 `sql.js@1.14.2` 固定源码构建，保持 FTS3、normalize 与贡献扩展函数，是本包的默认完整能力基线。
- `lite` 基于同一 sql.js 版本重新编译，固定 SQLite 3.49.1 与 Emscripten 5.0.0，保留普通表、索引、事务、触发器、CTE、JSON1、ALTER、参数绑定、BLOB 和数据库导入导出；明确移除 FTS3、SQLite normalized SQL（`getNormalizedSQL()`）和 sql.js 贡献的数学/字符串/聚合函数（例如 `reverse()`）。

`full` 与 `lite` 生成的数据库文件使用相同的 SQLite 文件格式，可以互相导入导出；如果数据库包含 FTS3 虚表，`lite` 不能执行该虚表相关 SQL。`lite` 主要用于降低 WASM 包体积，不应默认视为查询性能更高的版本。普通 `LIKE`/`GLOB`、事务和迁移不受这些裁剪影响。

两种变体共享持久化补丁：`exportSnapshot()` 使用 SQLite 的 `sqlite3_serialize` 复制主数据库，不关闭连接，保留 PRAGMA、临时表、准备语句、自定义函数与更新 hook；`execWithMetadata(sql, parameters)` 返回 `{ results, readOnly }`，按实际执行的每条 SQLite 语句判断是否可能直接修改数据库。原有 `exec()` 返回值与 `export()` 行为保持 sql.js 语义，adapter 使用新的快照接口，避免原 `export()` 关闭并重开连接导致会话状态丢失。

`readOnly` 表示语句没有直接修改数据库文件的可能，不保证自定义 SQL 函数没有外部副作用。多条 SQL 按顺序执行，后续语句可以引用前面新建的表；需要整组原子性时使用 core 的 `transaction()`。

- `@weapp-sqlite/sqljs/node` 仅供构建期解析 full/lite 的 WASM 文件名与绝对路径。

full/lite 的来源、版本、源码补丁哈希、产物哈希与许可证会复制到发布包。两者固定 SQLite 3.49.1、Emscripten 5.0.0 与 sql.js commit `9c4e167ec37129192d166ab9223faa9a4bd07c58`。普通消费者构建不依赖 Docker 或 Emscripten。

```bash
pnpm --filter @weapp-sqlite/sqljs verify:engines
pnpm --filter @weapp-sqlite/sqljs rebuild:engines
```

`rebuild:engines` 使用固定的 `emscripten/emsdk:5.0.0` Docker 镜像重新生成 full、full browser 与 lite 资源，然后刷新哈希并检查 lite 体积预算。`rebuild:lite` 和 `verify:lite` 保留为兼容入口，现在分别重建或校验整组引擎。

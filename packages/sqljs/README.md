# @weapp-sqlite/sqljs

`weapp-sqlite` 使用的 sql.js 引擎与 WASM 资源包。

```ts
import initSqlJs from '@weapp-sqlite/sqljs/full'
// 或 import initSqlJs from '@weapp-sqlite/sqljs/lite'
```

- `full` 包装官方 `sql.js@1.14.2`，保持 FTS3、normalize 与贡献扩展函数，是本包的默认完整能力基线。
- `lite` 基于同一 sql.js 版本重新编译，固定 SQLite 3.49.1 与 Emscripten 5.0.0，保留普通表、索引、事务、触发器、CTE、JSON1、ALTER、参数绑定、BLOB 和数据库导入导出；明确移除 FTS3、SQLite normalized SQL（`getNormalizedSQL()`）和 sql.js 贡献的数学/字符串/聚合函数（例如 `reverse()`）。

`full` 与 `lite` 生成的数据库文件使用相同的 SQLite 文件格式，可以互相导入导出；如果数据库包含 FTS3 虚表，`lite` 不能执行该虚表相关 SQL。`lite` 主要用于降低 WASM 包体积，不应默认视为查询性能更高的版本。普通 `LIKE`/`GLOB`、事务和迁移不受这些裁剪影响。

- `@weapp-sqlite/sqljs/node` 仅供构建期解析 full/lite 的 WASM 文件名与绝对路径。

lite 的来源、版本、哈希与许可证会复制到发布包。普通消费者构建不依赖 Docker 或 Emscripten。

```bash
pnpm --filter @weapp-sqlite/sqljs verify:lite
pnpm --filter @weapp-sqlite/sqljs rebuild:lite
```

`rebuild:lite` 使用固定的 `emscripten/emsdk:5.0.0` Docker 镜像重新生成资源，然后刷新哈希并检查体积预算。

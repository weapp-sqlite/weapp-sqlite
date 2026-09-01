# @weapp-sqlite/sqljs

`weapp-sqlite` 使用的 sql.js 引擎与 WASM 资源包。

```ts
import initSqlJs from '@weapp-sqlite/sqljs/full'
// 或 import initSqlJs from '@weapp-sqlite/sqljs/lite'
```

- `full` 包装 `sql.js@1.14.2`，保持 FTS3、normalize 与贡献扩展函数。
- `lite` 固定 SQLite 3.49.1 与 Emscripten 5.0.0，保留普通表、索引、事务、触发器、CTE、JSON1、ALTER、参数绑定、BLOB 和数据库导入导出；不提供 FTS3、normalize 与贡献数学/字符串函数。
- `@weapp-sqlite/sqljs/node` 仅供构建期解析 full/lite 的 WASM 文件名与绝对路径。

lite 的来源、版本、哈希与许可证会复制到发布包。普通消费者构建不依赖 Docker 或 Emscripten。

```bash
pnpm --filter @weapp-sqlite/sqljs verify:lite
pnpm --filter @weapp-sqlite/sqljs rebuild:lite
```

`rebuild:lite` 使用固定的 `emscripten/emsdk:5.0.0` Docker 镜像重新生成资源，然后刷新哈希并检查体积预算。

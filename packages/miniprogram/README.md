# @weapp-sqlite/miniprogram

通用小程序 SQLite 宿主协议、能力探测、文件持久化和 WASM 初始化边界。

普通业务代码不应直接引用 `wx`、`WXWebAssembly` 或 WASM 路径；weapp-vite 项目请使用 [`@weapp-sqlite/weapp-vite`](https://www.npmjs.com/package/@weapp-sqlite/weapp-vite) 统一注入。

```bash
pnpm add @weapp-sqlite/miniprogram @weapp-sqlite/wasm @weapp-sqlite/sqljs
```

```ts
import { createMiniProgramSqlJsInitializer } from '@weapp-sqlite/miniprogram'
import { initSqlJsFull } from '@weapp-sqlite/sqljs/full'

const initializer = createMiniProgramSqlJsInitializer({
  platform: 'weapp',
  runtime: wx,
  webAssembly: WXWebAssembly,
  packageBinaryPath: '/assets/sql-wasm.wasm',
  initializer: initSqlJsFull,
})
```

微信 adapter 使用 `getFileSystemManager()` 和 `USER_DATA_PATH` 保存快照，并通过 `WXWebAssembly` 按代码包路径实例化。其他五个平台可以构建，但缺少真实宿主证据或能力时返回结构化 `unsupported`，不会回退到内存数据库。

内置存储要求宿主提供 `mkdir/readFile/writeFile/unlink/rename`。保存先写同目录临时文件，再将旧快照移为备份、发布新快照；重命名不覆盖已有目标。读取优先使用正式文件，只有正式文件不存在时才恢复备份，不会加载未提交的临时文件。删除按临时文件、备份、正式文件的顺序执行，避免残留备份恢复已删除的数据。缺少 `rename` 会返回 `MINIPROGRAM_SQLITE_FILESYSTEM_UNAVAILABLE`，只读包资源加载不受该约束影响。

同一 JavaScript 上下文内，共享 runtime 或文件系统实例、且指向相同数据库路径的存储操作按调用顺序执行；不同数据库和宿主互不阻塞。该恢复协议保留原 `.sqlite` 路径并兼容已有快照；跨进程并发与断电持久性仍需真实宿主验证。

业务项目通常应使用统一的 `openSqlite()` 入口。详见 [小程序 API](https://sqlite.weapp.dev/docs/api/miniprogram) 和 [多端接入](https://sqlite.weapp.dev/docs/multi-platform)。

# @weapp-sqlite/miniprogram

通用小程序 SQLite 宿主协议、能力探测、文件持久化和 WASM 初始化边界。

普通业务代码不应直接引用 `wx`、`WXWebAssembly` 或 WASM 路径；weapp-vite 项目请使用 [`@weapp-sqlite/weapp-vite`](https://www.npmjs.com/package/@weapp-sqlite/weapp-vite) 统一注入。

```bash
pnpm add @weapp-sqlite/miniprogram @weapp-sqlite/wasm
```

```ts
import { createMiniProgramSqlJsInitializer } from '@weapp-sqlite/miniprogram'

const initializer = createMiniProgramSqlJsInitializer({
  platform: 'weapp',
  runtime: wx,
  webAssembly: WXWebAssembly,
  packageBinaryPath: '/assets/sql-wasm.wasm',
  initializer: initSqlJs,
})
```

微信 adapter 使用 `getFileSystemManager()` 和 `USER_DATA_PATH` 保存快照，并通过 `WXWebAssembly` 按代码包路径实例化。其他五个平台可以构建，但缺少真实宿主证据或能力时返回结构化 `unsupported`，不会回退到内存数据库。

业务项目通常应使用统一的 `openSqlite()` 入口。详见 [小程序 API](https://sqlite.weapp.dev/docs/api/miniprogram) 和 [多端接入](https://sqlite.weapp.dev/docs/multi-platform)。

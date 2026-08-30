# @weapp-sqlite/miniprogram

通用小程序 SQLite 宿主协议、能力探测、文件持久化和 WASM 初始化边界。

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

当前正式运行支持以微信 DevTools、iOS 和 Android 验收证据为准。其他小程序平台可以实现相同 adapter 协议；能力不足时会返回结构化 `unsupported`，不会回退到内存数据库。

业务项目通常应使用 `@weapp-sqlite/weapp-vite` 的统一入口。

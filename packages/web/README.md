# @weapp-sqlite/web

面向浏览器的 SQLite WASM 持久化 adapter，使用 IndexedDB 保存数据库二进制快照，并提供开发期文件导入导出能力。

```bash
pnpm add @weapp-sqlite/web @weapp-sqlite/wasm
```

```ts
import { createIndexedDbSqliteWasmStorage } from '@weapp-sqlite/web'

const storage = createIndexedDbSqliteWasmStorage({
  databaseName: 'app.sqlite',
})
```

该 adapter 不会在 IndexedDB 不可用时静默回退到内存数据库。

完整文档与支持矩阵见 [weapp-sqlite 仓库](https://github.com/weapp-sqlite/weapp-sqlite)。

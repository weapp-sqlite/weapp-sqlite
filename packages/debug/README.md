# @weapp-sqlite/debug

宿主无关的 SQLite 数据调试控制器，提供表结构与分页预览、受控 SQL、CRUD、索引管理、CSV/JSON 导入导出和单步快照撤销。

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

该能力只应进入开发或验收构建。写 SQL、导入和结构修改均需要显式写权限，并受危险语句和快照限制。

weapp-vite 项目可使用 `@weapp-sqlite/weapp-vite` 生成独立数据工作台。

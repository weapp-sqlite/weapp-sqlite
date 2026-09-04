# @weapp-sqlite/weapp-vite

## 0.2.0

### Minor Changes

- 新增可选 lite SQLite WASM 引擎与微信普通分包按需加载，在保持 openSqlite API 不变的同时降低主包体积，并保留默认 full 引擎兼容行为。

### Patch Changes

- 完善 SQLite 全端新手文档，补充从安装、迁移、事务、持久化到调试工作台和多端验收的完整上手路径，并同步各包 README 的使用边界与常见问题。

- Updated dependencies:
  - @weapp-sqlite/core@0.1.1
  - @weapp-sqlite/debug@0.1.1
  - @weapp-sqlite/miniprogram@0.1.1
  - @weapp-sqlite/sqljs@0.2.0
  - @weapp-sqlite/wasm@0.1.1
  - @weapp-sqlite/web@0.1.1

## 0.1.0

### Minor Changes

- 新增跨端 SQLite 数据管理工作台，提供表与索引管理、结构化筛选、行 CRUD、单步撤销、SQLite/CSV/JSON 导入导出，以及 Web 和微信的安全文件交付能力；生产构建会剔除调试路由与管理代码。

- 新增 weapp-vite 全端统一 `openSqlite()`、目标专用 WASM 资源和连接生命周期管理，并为六个小程序目标提供可探测的文件系统与 WebAssembly adapter。

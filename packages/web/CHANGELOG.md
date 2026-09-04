# @weapp-sqlite/web

## 0.1.1

### Patch Changes

- 完善 SQLite 全端新手文档，补充从安装、迁移、事务、持久化到调试工作台和多端验收的完整上手路径，并同步各包 README 的使用边界与常见问题。

- Updated dependencies:
  - @weapp-sqlite/wasm@0.1.1

## 0.1.0

### Minor Changes

- 新增跨端 SQLite 数据管理工作台，提供表与索引管理、结构化筛选、行 CRUD、单步撤销、SQLite/CSV/JSON 导入导出，以及 Web 和微信的安全文件交付能力；生产构建会剔除调试路由与管理代码。

- 新增 IndexedDB Web 持久化 adapter 和通用小程序宿主协议，首期提供微信文件系统 driver、能力探测与稳定的不支持错误契约。

# @weapp-sqlite/debug

## 0.1.1

### Patch Changes

- 完善 SQLite 全端新手文档，补充从安装、迁移、事务、持久化到调试工作台和多端验收的完整上手路径，并同步各包 README 的使用边界与常见问题。

- Updated dependencies:
  - @weapp-sqlite/core@0.1.1
  - @weapp-sqlite/wasm@0.1.1

## 0.1.0

### Minor Changes

- 新增开发期 SQLite 数据调试、表预览、受控 SQL、快照导入导出和重置能力，并允许微信调试桥接获取数据库快照文件路径。

- 新增跨端 SQLite 数据管理工作台，提供表与索引管理、结构化筛选、行 CRUD、单步撤销、SQLite/CSV/JSON 导入导出，以及 Web 和微信的安全文件交付能力；生产构建会剔除调试路由与管理代码。

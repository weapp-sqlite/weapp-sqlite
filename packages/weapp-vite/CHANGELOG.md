# @weapp-sqlite/weapp-vite

## 0.3.0

### Minor Changes

- 新增迁移与外键只读诊断，面板可查看待执行、未知版本、迁移名称冲突、外键约束开关和完整性违规；工作台配置的迁移定义会同步用于诊断。

- 完善事务失败与持久化恢复，使用无副作用快照和原生语句只读信息，新增事务化批量执行与只读迁移诊断，并提供自定义引擎升级说明。

- 新增受管调试会话、独立 Devframe 面板、多数据库切换、SQL 历史与执行计划。

### Patch Changes

- 自动发现的运行时数据库复用 `openSqlite()` 的迁移定义，Devframe 面板中的迁移与外键诊断可以覆盖未显式写入工作台配置的数据库。

- 修复小程序业务 runtime 打包时误引用 DevTools 调试分包的问题，避免真实微信开发工具运行时报跨分包模块缺失。

- 修正发布元数据中的内部 DevTools peer 依赖协议，确保自动发布流程可正常校验。

- 面板关闭时受控释放运行时调试会话，保留业务数据库连接，并增强 WebSocket 释放确认与生命周期幂等性。

- 撤销调试写入前同时核对数据库 revision 与持久化快照指纹，外部快照发生变化时拒绝恢复过期数据。

- 修复 watch 重建时误删生成的 SQLite 调试页面与 WASM 加载文件的问题，并在 watcher 退出时统一释放调试资源。

- Updated dependencies:
  - @weapp-sqlite/core@0.2.0
  - @weapp-sqlite/debug@0.2.0
  - @weapp-sqlite/miniprogram@0.2.0
  - @weapp-sqlite/sqljs@0.3.0
  - @weapp-sqlite/wasm@0.2.0
  - @weapp-sqlite/web@0.2.0

## 0.2.2

### Patch Changes

- 修复微信自动分包对 `app.json.ts` 的硬编码限制，改为校验 weapp-vite 解析后的最终应用清单，并支持 `app.json.js` 与 `app.vue` 配置入口。

- 将开发依赖 weapp-vite 升级到 7.1.2，公开 API 与 peer `weapp-vite >= 6.22.0` 保持不变。

## 0.2.1

### Patch Changes

- 升级工作区构建工具与兼容依赖，保持 SQLite runtime 的公开 API 和跨宿主行为不变。

- Updated dependencies:
  - @weapp-sqlite/core@0.1.2
  - @weapp-sqlite/debug@0.1.2
  - @weapp-sqlite/miniprogram@0.1.2
  - @weapp-sqlite/sqljs@0.2.1
  - @weapp-sqlite/wasm@0.1.2
  - @weapp-sqlite/web@0.1.2

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

# @weapp-sqlite/sqljs

## 0.3.0

### Minor Changes

- 完善事务失败与持久化恢复，使用无副作用快照和原生语句只读信息，新增事务化批量执行与只读迁移诊断，并提供自定义引擎升级说明。

### Patch Changes

- Updated dependencies:
  - @weapp-sqlite/wasm@0.2.0

## 0.2.1

### Patch Changes

- 升级工作区构建工具与兼容依赖，保持 SQLite runtime 的公开 API 和跨宿主行为不变。

- Updated dependencies:
  - @weapp-sqlite/wasm@0.1.2

## 0.2.0

### Minor Changes

- 新增可选 lite SQLite WASM 引擎与微信普通分包按需加载，在保持 openSqlite API 不变的同时降低主包体积，并保留默认 full 引擎兼容行为。

### Patch Changes

- Updated dependencies:
  - @weapp-sqlite/wasm@0.1.1

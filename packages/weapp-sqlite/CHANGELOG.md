# weapp-sqlite

## 0.2.0

### Minor Changes

- 完善事务失败与持久化恢复，使用无副作用快照和原生语句只读信息，新增事务化批量执行与只读迁移诊断，并提供自定义引擎升级说明。

### Patch Changes

- Updated dependencies:
  - @weapp-sqlite/weapp-vite@0.3.0

## 0.1.1

### Patch Changes

- 新增无 scope 的 `weapp-sqlite` 门面包，统一导出 weapp-vite SQLite 插件与运行时入口。

- Updated dependencies:
  - @weapp-sqlite/weapp-vite@0.2.2

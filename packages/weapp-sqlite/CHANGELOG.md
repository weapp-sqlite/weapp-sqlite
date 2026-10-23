# weapp-sqlite

## 0.2.1

### Patch Changes

- 修复双格式导出的 TypeScript 声明解析，按 import 与 require 分别使用 ESM 和 CommonJS 声明，并为 sqljs 浏览器入口匹配对应声明。修复构建插件和 DevTools 声明的 CommonJS 兼容性，避免插件类型引入多平台全局声明冲突。为依赖构建器虚拟模块的 runtime、debug、workspace 和 devtools-runtime 入口显式声明不支持裸 Node 执行，保留类型检查及 Web、小程序构建行为。

- Updated dependencies:
  - @weapp-sqlite/weapp-vite@0.3.1

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

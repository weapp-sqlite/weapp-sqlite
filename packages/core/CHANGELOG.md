# @weapp-sqlite/core

## 0.2.1

### Patch Changes

- 修复双格式导出的 TypeScript 声明解析，按 import 与 require 分别使用 ESM 和 CommonJS 声明，并为 sqljs 浏览器入口匹配对应声明。修复构建插件和 DevTools 声明的 CommonJS 兼容性，避免插件类型引入多平台全局声明冲突。为依赖构建器虚拟模块的 runtime、debug、workspace 和 devtools-runtime 入口显式声明不支持裸 Node 执行，保留类型检查及 Web、小程序构建行为。

## 0.2.0

### Minor Changes

- 完善事务失败与持久化恢复，使用无副作用快照和原生语句只读信息，新增事务化批量执行与只读迁移诊断，并提供自定义引擎升级说明。

## 0.1.2

### Patch Changes

- 升级工作区构建工具与兼容依赖，保持 SQLite runtime 的公开 API 和跨宿主行为不变。

## 0.1.1

### Patch Changes

- 完善 SQLite 全端新手文档，补充从安装、迁移、事务、持久化到调试工作台和多端验收的完整上手路径，并同步各包 README 的使用边界与常见问题。

## 0.1.0

### Minor Changes

- 新增开发期 SQLite 数据调试、表预览、受控 SQL、快照导入导出和重置能力，并允许微信调试桥接获取数据库快照文件路径。

- 新增宿主无关的异步 SQLite core 协议与可注入 WASM adapter，支持事务、迁移和数据库文件持久化。

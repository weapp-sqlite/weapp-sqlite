# @weapp-sqlite/miniprogram

## 0.2.1

### Patch Changes

- 修复双格式导出的 TypeScript 声明解析，按 import 与 require 分别使用 ESM 和 CommonJS 声明，并为 sqljs 浏览器入口匹配对应声明。修复构建插件和 DevTools 声明的 CommonJS 兼容性，避免插件类型引入多平台全局声明冲突。为依赖构建器虚拟模块的 runtime、debug、workspace 和 devtools-runtime 入口显式声明不支持裸 Node 执行，保留类型检查及 Web、小程序构建行为。

- Updated dependencies:
  - @weapp-sqlite/wasm@0.2.1

## 0.2.0

### Minor Changes

- 增强小程序文件与 Web IndexedDB 持久化 adapter 的并发协调、失败恢复和重试能力，并补充宿主能力诊断与调试文件边界。

### Patch Changes

- Updated dependencies:
  - @weapp-sqlite/wasm@0.2.0

## 0.1.2

### Patch Changes

- 升级工作区构建工具与兼容依赖，保持 SQLite runtime 的公开 API 和跨宿主行为不变。

- Updated dependencies:
  - @weapp-sqlite/wasm@0.1.2

## 0.1.1

### Patch Changes

- 完善 SQLite 全端新手文档，补充从安装、迁移、事务、持久化到调试工作台和多端验收的完整上手路径，并同步各包 README 的使用边界与常见问题。

- Updated dependencies:
  - @weapp-sqlite/wasm@0.1.1

## 0.1.0

### Minor Changes

- 新增开发期 SQLite 数据调试、表预览、受控 SQL、快照导入导出和重置能力，并允许微信调试桥接获取数据库快照文件路径。

- 新增跨端 SQLite 数据管理工作台，提供表与索引管理、结构化筛选、行 CRUD、单步撤销、SQLite/CSV/JSON 导入导出，以及 Web 和微信的安全文件交付能力；生产构建会剔除调试路由与管理代码。

- 新增 IndexedDB Web 持久化 adapter 和通用小程序宿主协议，首期提供微信文件系统 driver、能力探测与稳定的不支持错误契约。

- 新增通用的 sql.js 小程序初始化器和微信 `WXWebAssembly` 路径式实例化支持，并为运行时不兼容与实例化失败提供稳定错误契约。

- 新增 weapp-vite 全端统一 `openSqlite()`、目标专用 WASM 资源和连接生命周期管理，并为六个小程序目标提供可探测的文件系统与 WebAssembly adapter。

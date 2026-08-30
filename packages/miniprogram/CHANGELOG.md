# @weapp-sqlite/miniprogram

## 0.1.0

### Minor Changes

- 新增开发期 SQLite 数据调试、表预览、受控 SQL、快照导入导出和重置能力，并允许微信调试桥接获取数据库快照文件路径。

- 新增跨端 SQLite 数据管理工作台，提供表与索引管理、结构化筛选、行 CRUD、单步撤销、SQLite/CSV/JSON 导入导出，以及 Web 和微信的安全文件交付能力；生产构建会剔除调试路由与管理代码。

- 新增 IndexedDB Web 持久化 adapter 和通用小程序宿主协议，首期提供微信文件系统 driver、能力探测与稳定的不支持错误契约。

- 新增通用的 sql.js 小程序初始化器和微信 `WXWebAssembly` 路径式实例化支持，并为运行时不兼容与实例化失败提供稳定错误契约。

- 新增 weapp-vite 全端统一 `openSqlite()`、目标专用 WASM 资源和连接生命周期管理，并为六个小程序目标提供可探测的文件系统与 WebAssembly adapter。

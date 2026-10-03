# @weapp-sqlite/debug

## 0.2.0

### Minor Changes

- 新增迁移与外键只读诊断，面板可查看待执行、未知版本、迁移名称冲突、外键约束开关和完整性违规；工作台配置的迁移定义会同步用于诊断。

- 新增只读查询性能诊断 API 与面板入口，展示 `EXPLAIN QUERY PLAN` 的节点、索引、全表扫描、临时 B-tree 和自动索引信息。

- 新增受管调试会话、独立 Devframe 面板、多数据库切换、SQL 历史与执行计划。

### Patch Changes

- 为大表增加绑定稳定主键或 rowid 的 keyset 游标分页，面板翻页时避免深页重复扫描前置行，并保留原有 offset 分页兼容。

- 修正查询性能诊断对 SQLite 自动覆盖索引计划的识别，避免连接查询漏报自动索引警告。

- 修复只读查询与性能诊断对 WITH 查询的识别，并继续拒绝 CTE 写操作。

- 补充查询性能诊断：标注临时 B-tree 由排序、分组或去重触发，并在 DevTools 面板中展示用途，帮助定位可优化的 SQL。

- 优化大表分页浏览：按数据库 revision 缓存筛选总行数，写入后自动失效，将越界分页偏移修正到最后一个有效页，并让面板使用受 `maxRows` 约束后的实际页大小翻页。

- 稳定大表分页顺序：未指定排序时按可用 rowid 或完整主键排序，显式排序追加定位列作为升序 tie-breaker，避免 offset 翻页重复或跳过。

- 修正表格浏览对 SQLite 隐藏生成列的处理，避免隐藏字段污染页面数据并保持行定位器可用。

- 撤销调试写入前同时核对数据库 revision 与持久化快照指纹，外部快照发生变化时拒绝恢复过期数据。

- 修复外键 schema mismatch 导致诊断整次失败的问题；现在会按表返回结构错误，并继续展示其他表的约束违规结果。

- Updated dependencies:
  - @weapp-sqlite/core@0.2.0
  - @weapp-sqlite/wasm@0.2.0

## 0.1.2

### Patch Changes

- 升级工作区构建工具与兼容依赖，保持 SQLite runtime 的公开 API 和跨宿主行为不变。

- Updated dependencies:
  - @weapp-sqlite/core@0.1.2
  - @weapp-sqlite/wasm@0.1.2

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

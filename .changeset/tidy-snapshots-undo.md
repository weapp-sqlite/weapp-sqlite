---
"@weapp-sqlite/debug": patch
"@weapp-sqlite/weapp-vite": patch
---

撤销调试写入前同时核对数据库 revision 与持久化快照指纹，外部快照发生变化时拒绝恢复过期数据。

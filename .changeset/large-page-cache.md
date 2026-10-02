---
'@weapp-sqlite/debug': patch
---

优化大表分页浏览：按数据库 revision 缓存筛选总行数，写入后自动失效，将越界分页偏移修正到最后一个有效页，并让面板使用受 `maxRows` 约束后的实际页大小翻页。

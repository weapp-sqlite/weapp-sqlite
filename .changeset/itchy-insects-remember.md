---
"@weapp-sqlite/debug": patch
---

修复只读查询与性能诊断对 WITH 查询的识别，并继续拒绝 CTE 写操作。

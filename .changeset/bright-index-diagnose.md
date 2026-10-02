---
"@weapp-sqlite/debug": patch
---

修正查询性能诊断对 SQLite 自动覆盖索引计划的识别，避免连接查询漏报自动索引警告。

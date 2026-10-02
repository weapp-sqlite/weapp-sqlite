---
"@weapp-sqlite/debug": patch
"@weapp-sqlite/devtools": patch
---

为大表增加绑定稳定主键或 rowid 的 keyset 游标分页，面板翻页时避免深页重复扫描前置行，并保留原有 offset 分页兼容。

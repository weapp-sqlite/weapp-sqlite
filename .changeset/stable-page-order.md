---
"@weapp-sqlite/debug": patch
---

稳定大表分页顺序：未指定排序时按可用 rowid 或完整主键排序，显式排序追加定位列作为升序 tie-breaker，避免 offset 翻页重复或跳过。

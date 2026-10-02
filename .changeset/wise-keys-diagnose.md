---
"@weapp-sqlite/debug": patch
"@weapp-sqlite/devtools": patch
---

修复外键 schema mismatch 导致诊断整次失败的问题；现在会按表返回结构错误，并继续展示其他表的约束违规结果。

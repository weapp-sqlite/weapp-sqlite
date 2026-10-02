---
"@weapp-sqlite/devtools": patch
---

运行实例重连并复用原实例 ID 时，面板会使旧请求失效并刷新当前数据库，避免过期响应覆盖新会话状态。

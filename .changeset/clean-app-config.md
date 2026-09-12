---
'@weapp-sqlite/weapp-vite': patch
---

修复微信自动分包对 `app.json.ts` 的硬编码限制，改为校验 weapp-vite 解析后的最终应用清单，并支持 `app.json.js` 与 `app.vue` 配置入口。

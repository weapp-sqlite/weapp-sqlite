---
"@weapp-sqlite/core": patch
"@weapp-sqlite/debug": patch
"@weapp-sqlite/devtools": patch
"@weapp-sqlite/miniprogram": patch
"@weapp-sqlite/sqljs": patch
"@weapp-sqlite/wasm": patch
"@weapp-sqlite/weapp-vite": patch
"@weapp-sqlite/web": patch
"weapp-sqlite": patch
---

修复双格式导出的 TypeScript 声明解析，按 import 与 require 分别使用 ESM 和 CommonJS 声明，并为 sqljs 浏览器入口匹配对应声明，避免 CommonJS 消费者误用 ESM 类型。

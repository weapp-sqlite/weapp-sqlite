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

修复双格式导出的 TypeScript 声明解析，按 import 与 require 分别使用 ESM 和 CommonJS 声明，并为 sqljs 浏览器入口匹配对应声明。修复构建插件和 DevTools 声明的 CommonJS 兼容性，避免插件类型引入多平台全局声明冲突。为依赖构建器虚拟模块的 runtime、debug、workspace 和 devtools-runtime 入口显式声明不支持裸 Node 执行，保留类型检查及 Web、小程序构建行为。

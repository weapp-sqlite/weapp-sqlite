---
"@weapp-sqlite/weapp-vite": patch
---

修复小程序业务 runtime 打包时误引用 DevTools 调试分包的问题，避免真实微信开发工具运行时报跨分包模块缺失。

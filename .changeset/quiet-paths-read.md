---
'@weapp-sqlite/miniprogram': patch
'@weapp-sqlite/weapp-vite': patch
---

修复微信小程序 WASM path 模式的能力探测，避免读取真机不可访问的代码包二进制文件。

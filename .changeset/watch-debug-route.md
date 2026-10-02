---
"@weapp-sqlite/weapp-vite": patch
---

修复 watch 重建时误删生成的 SQLite 调试页面与 WASM 加载文件的问题，并在 watcher 退出时统一释放调试资源。

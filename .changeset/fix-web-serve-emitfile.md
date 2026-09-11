---
'@weapp-sqlite/weapp-vite': patch
---

Web serve 不再在 `buildStart` 调用 `emitFile()`，改由现有 middleware 提供 WASM，避免 Vite 8 在 `wv dev -p web` 中报 serve 不兼容；生产构建仍会把 WASM 写入产物。

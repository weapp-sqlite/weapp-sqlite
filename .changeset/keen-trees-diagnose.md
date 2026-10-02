---
"@weapp-sqlite/debug": patch
"@weapp-sqlite/devtools": patch
---

补充查询性能诊断：标注临时 B-tree 由排序、分组或去重触发，并在 DevTools 面板中展示用途，帮助定位可优化的 SQL。

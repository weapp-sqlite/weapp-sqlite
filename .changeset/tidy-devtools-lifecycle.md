---
'@weapp-sqlite/devtools': patch
---

修复 DevTools 独立服务与 Vite 开发服务关闭时的连接释放竞态，并保证并发释放操作只执行一次。

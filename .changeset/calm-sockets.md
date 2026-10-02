---
"@weapp-sqlite/devtools": patch
---

增强 Web 与微信 `SocketTask` 通信适配：支持 UTF-8 `ArrayBuffer` 消息，处理连接和发送的同步失败，保证关闭幂等并释放过期连接。

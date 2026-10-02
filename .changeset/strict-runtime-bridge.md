---
"@weapp-sqlite/devtools": patch
---

收紧 DevTools runtime 通信边界：宿主已认证时面板复用受信 Devframe 会话，适配器同步失败时及时释放过期 Socket，非法错误码会转换为稳定的协议错误，数据库卸载期间拒绝过期请求，并阻止面板通过 RPC 关闭业务连接。

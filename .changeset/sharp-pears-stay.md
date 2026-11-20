---
"@weapp-sqlite/sqljs": patch
---

恢复宿主缺少 `TextDecoder` 时的降级路径，使微信 iOS 的 JavaScriptCore 不再在引擎实例化时抛出 `ReferenceError`。
解码边界：非合法 UTF-8 的 ≤ 16 字节 TEXT 值不再由宿主 `TextDecoder` 展开，可能落到 U+0000，以 -1 长度绑回时被截断为空值，而 `TEXTDECODER=2` 存下 U+FFFD。

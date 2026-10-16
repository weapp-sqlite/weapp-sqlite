# Logo 使用说明

weapp-sqlite 的标志由两片旋转对称的数据块互扣而成，中间贯通的 S 形留白呼应 SQLite。紧凑的块面表达本地存储，互扣关系表达运行时与宿主适配器的连接。图标使用实色和透明留白，小尺寸、单色和深浅背景共用同一轮廓。

![Logo、头像、深色与小尺寸预览](./previews/identity.png)

[2026-10-16 验收记录](./validation-2026-10-16.md)

## 文件

| 文件                               | 用途                                              |
| ---------------------------------- | ------------------------------------------------- |
| `weapp-sqlite-icon.svg`            | 透明底彩色符号，文档导航、生态项目图标、favicon   |
| `weapp-sqlite-avatar.svg` / `.png` | 深墨色圆角头像，512 × 512，适合 GitHub 和社交头像 |
| `weapp-sqlite-logo-horizontal.svg` | 彩色符号配深色字标，适合浅色背景和 README         |
| `weapp-sqlite-logo-monochrome.svg` | 全深色组合标，适合单色印刷和浅色背景              |
| `weapp-sqlite-logo-reversed.svg`   | 全白组合标，适合深色背景                          |
| `source/symbol.svg`                | 可编辑的符号源文件，64 × 64                       |
| `source/wordmark.svg`              | 已转为路径的字标源文件，无字体加载依赖            |

文档站同时提供 16 / 32px PNG favicon 和 180px Apple touch icon，由同一来源生成。README 使用 `<picture>` 随系统主题选择横版或反白版。

## 色板

| 用途           | 色值      |
| -------------- | --------- |
| 上片数据块     | `#09B86C` |
| 下片数据块     | `#078E8B` |
| 字标、头像背景 | `#08141D` |
| 反白组合标     | `#FFFFFF` |

## 比例与使用

- 透明图标画布为 64 × 64，图形占 56 × 56；S 形通道宽 8 单位。保持完整画布，避免再加一层图标底板。
- favicon 最小 16px；导航与项目列表建议至少 32px。头像推荐使用原始 512px PNG。
- 横版组合标建议至少 200px 宽，保持比例；更小的场景使用独立符号。
- 图标与其他元素之间保留至少 8 单位（画布宽度的 1/8）的空间。头像已为圆形裁切留出安全区。
- 不拉伸、旋转、拆分两片色块或填满 S 形通道；不添加渐变、描边和阴影。
- 深色背景使用彩色符号或反白组合标；单色输出使用提供的单色版本。
- 所有发布的 SVG 都包含可访问名称，使用 `<img>` 时仍需设置合适的 `alt`；紧邻完整项目名的装饰图标使用 `alt=""`。

## 修改与同步

只编辑 `source/symbol.svg` 和 `source/wordmark.svg`，再在仓库根目录执行：

```bash
pnpm brand:generate
pnpm brand:check
```

生成命令统一更新本目录的五个 SVG、头像 PNG，以及 `apps/docs/public` 的图标、头像与 favicon；检查命令验证这些文件与来源一致。不要单独修改生成的副本或位图。

符号是本项目的原创矢量图形。字标基于 [Geist](https://github.com/vercel/geist-font) 620 字重生成路径，采用 50 单位 em 和 -0.65 单位字距；字体来源为 `@fontsource-variable/geist` 5.3.0 的 Latin normal，许可见 [LICENSE-Geist.txt](./LICENSE-Geist.txt)。SVG 中保留的是字形路径，使用者无需安装字体。

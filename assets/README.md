# Logo 使用说明

weapp-sqlite 的标志把小程序/Web 宿主窗口和 SQLite 数据库圆柱组合在一起：窗口表达跨宿主运行，数据库圆柱表达本地持久化能力。

## 文件

- `weapp-sqlite-avatar.svg`：带深色圆角底的主头像，适合 GitHub、应用图标和社交头像。
- `weapp-sqlite-icon.svg`：透明底彩色图标，适合文档导航、favicon 和浅色背景。
- `weapp-sqlite-logo-horizontal.svg`：彩色横版组合标，适合 README、官网页头和项目介绍。
- `weapp-sqlite-logo-monochrome.svg`：深色单色版，适合黑白打印和浅色底。
- `weapp-sqlite-logo-reversed.svg`：白色反白版，适合深色背景。

## 色板

| 用途 | 色值 |
| --- | --- |
| 深海蓝背景 | `#071521` |
| 窗口薄荷青 | `#65E6C2` |
| 窗口青蓝 | `#29B6C9` |
| 数据库酸绿 | `#C4FF85` |
| 数据库绿 | `#36C875` |
| 正文墨色 | `#08141D` |

## 使用规则

- 彩色图标建议保持至少 `32px`，头像建议使用 `512px` 原尺寸。
- 横版组合标建议保持至少 `180px` 宽，并按原始比例缩放。
- 图标四周保留不少于图标高度 `1/8` 的留白，不要裁切窗口或数据库圆柱。
- 不要拉伸、旋转、改变渐变颜色、添加阴影或把彩色版本放在高噪声背景上。
- 深色背景优先使用 `weapp-sqlite-logo-reversed.svg`，浅色背景优先使用彩色或单色深色版本。

SVG 可直接用于网页的 `<img>`、内联 SVG 或 CSS `background-image`；需要 PNG 时，请从对应 SVG 导出，避免重复编辑位图。

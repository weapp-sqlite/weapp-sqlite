# weapp-sqlite 文档站

文档站使用 Next.js static export 与 Fumadocs，在构建期生成完整 HTML、搜索索引、Markdown 文本和 OG 图片。部署产物位于 `apps/docs/out`，Cloudflare Worker 通过 `ASSETS` 提供静态资源，不启用 SSR。

仓库开发使用 Node.js 24.22.1、pnpm 12.14.0。所有命令从仓库根目录执行：

```bash
pnpm --filter @weapp-sqlite/docs dev

# 构建默认预览渠道并检查站点部署契约
pnpm docs:build
pnpm docs:test
pnpm --filter @weapp-sqlite/docs preview
```

## 两个网站通道

| 通道 | 域名 | 更新来源 | Worker |
| --- | --- | --- | --- |
| `preview` | [preview.sqlite.weapp.dev](https://preview.sqlite.weapp.dev) | `main` | `weapp-sqlite-docs-preview` |
| `stable` | [sqlite.weapp.dev](https://sqlite.weapp.dev) | repoctl 完整稳定发布记录 | `weapp-sqlite-docs` |

构建时使用 `REPO_DOCS_CHANNEL` 和 `REPO_DOCS_URL`。本地默认 `preview` 及其域名；页面元数据与 Open Graph URL 随渠道生成。预览站有未发布提示，并通过 robots metadata、`robots.txt` 和 `X-Robots-Tag` 禁止收录。正式站使用稳定渠道 URL，允许收录。

`wrangler.jsonc` 的顶层配置对应正式 Worker，`env.preview` 对应预览 Worker；两者都将 `./out` 绑定为 `ASSETS`，Worker 仅调用 `env.ASSETS.fetch(request)`。

## 部署与维护

repoctl 的 `website` 站点使用 `repoctl-docs.yml`（Documentation）和 `repoctl-docs-deploy.yml` 先构建、验证来源，再部署同一份产物。`docs:deploy:preview` 与 `docs:deploy:stable` 是其部署 hooks，不重新构建，也不是日常手工部署入口。

GitHub environments `docs-website-preview` 和 `docs-website-stable` 仅允许 `main` 部署，各需要 `CLOUDFLARE_API_TOKEN` secret。`CLOUDFLARE_ACCOUNT_ID` 可使用 environment variable 或 secret，工作流优先读取 secret。迁移时先关闭旧 Workers Builds 对正式 Worker 的自动触发，再启用并验证预览流程；保留当前正式站，等待下一次完整稳定发布建立新基线。不要让 Cloudflare Builds 和 repoctl 同时更新正式域名。

这里描述的是仓库约定；远端凭据、域名、工作流首次运行和旧 Builds 关闭状态需在上线时确认。正式部署及文档修补应从稳定发布记录恢复，操作步骤见仓库 [RELEASE.md](../../RELEASE.md) 和[静态部署指南](https://sqlite.weapp.dev/docs/deployment/)。

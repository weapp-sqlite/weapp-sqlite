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

Wrangler 的 `build.command` 在上传前复用部署身份、Git HEAD、产物和渠道检查。顶部配置固定校验 `stable`，`env.preview` 固定校验 `preview`；裸 `wrangler deploy`、`wrangler versions upload` 和裸 `wrangler deploy --dry-run` 都必须满足对应条件。门禁不重新构建 Next.js，也不影响 `wrangler dev` 和 `wrangler types`。

本地只检查 Wrangler 配置和资产打包时，先构建，再使用固定执行 `--dry-run` 的入口；它不创建稳定发布记录或上传产物：

```bash
pnpm docs:build
pnpm --filter @weapp-sqlite/docs deploy:dry preview
pnpm --filter @weapp-sqlite/docs deploy:dry stable
```

这两个 dry-run 使用同一份本地产物检查两套部署配置，不代表该产物满足正式发布条件。入口临时复制配置、移除上传门禁并固定执行 `--dry-run`，随后删除临时配置；没有关闭真实部署门禁的环境变量。

GitHub environments `docs-website-preview` 和 `docs-website-stable` 仅允许 `main` 部署。`CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 可来自对本仓库开放的组织级或仓库级 secrets，通过 `secrets: inherit` 传入部署工作流；也可配置在对应 environment 中，同名 environment secret 优先。`CLOUDFLARE_ACCOUNT_ID` 还支持 variable，工作流优先读取 secret。继承凭据不改变 environment 的 `main` 部署限制。

迁移时先断开旧正式 Worker 的 Workers Builds Git 连接，再启用并验证预览流程；不要只依赖 Disable builds 开关，本次迁移中启用 Disable builds 后仍发生了旧构建。断开连接不会删除当前 Active Deployment 或域名；保留现有正式站，等待下一次完整稳定发布建立新基线。

组织级 Cloudflare secrets 已配置并对本仓库开放，预览站已完成首次受管部署及线上验收；切换状态及验收证据记录在仓库 [RELEASE.md](../../RELEASE.md)。正式部署及文档修补应从稳定发布记录恢复，操作步骤见[静态部署指南](https://sqlite.weapp.dev/docs/deployment/)。

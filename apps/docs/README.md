# weapp-sqlite 文档站

这是 `weapp-sqlite` 的 Fumadocs 文档站，使用 Next.js static export 在构建期生成完整 HTML、搜索索引、Markdown 文本和 OG 图片。线上只部署 `out/` 静态资源到 Cloudflare Worker，不启用 SSR。

本地开发：

```bash
pnpm --filter @weapp-sqlite/docs dev
```

构建并预览静态产物：

```bash
pnpm --filter @weapp-sqlite/docs build
pnpm --filter @weapp-sqlite/docs preview
```

部署到 `sqlite.weapp.dev`：

```bash
pnpm --filter @weapp-sqlite/docs wrangler:types
pnpm --filter @weapp-sqlite/docs run deploy:dry
pnpm --filter @weapp-sqlite/docs run deploy
```

`wrangler.jsonc` 使用 `assets.directory: "./out"` 和 `ASSETS` binding；Worker 本身只调用 `env.ASSETS.fetch(request)`。

生产部署由 Cloudflare Workers Builds 监听 GitHub `main` 分支并自动完成，不需要 GitHub Actions Secrets。请在 Cloudflare Dashboard 中连接 `weapp-sqlite/weapp-sqlite`，将构建根目录设为仓库根目录，构建命令设为 `pnpm install --frozen-lockfile && pnpm --filter @weapp-sqlite/docs build`，部署命令设为 `pnpm --filter @weapp-sqlite/docs exec wrangler deploy`。完整说明见文档站的[静态部署指南](https://sqlite.weapp.dev/docs/deployment/)。

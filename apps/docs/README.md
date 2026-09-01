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

推送到 `main` 后，`.github/workflows/docs-deploy.yml` 会自动构建并部署到 `sqlite.weapp.dev`。启用该 workflow 前，请在 GitHub Actions Secrets 中配置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。完整说明见文档站的[静态部署指南](https://sqlite.weapp.dev/docs/deployment/)。

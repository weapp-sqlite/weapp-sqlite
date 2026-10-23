# 发布维护与恢复

本仓库使用 repoctl 6.0.1、pnpm 12.14.0 和 Lefthook 2.2.2。开发与发布统一使用 Node.js 24.22.1；工具链支持范围为 `^22.23.4 || ^24.22.1 || >=26.12.1`，公开 runtime 包保留各自现有的 Node.js 要求。

repoctl 的实现依赖 `@icebreakers/monorepo@6.0.1` 使用仓库内的 pnpm 补丁：修复分阶段历史恢复时重复创建包管理器目录的 `EEXIST`，并允许恢复旧发布提交中已废弃的 `tooling.lintStaged` 配置。此兼容只作用于历史来源恢复，其余配置仍严格校验，历史源码不被改写。升级上游时须先运行发布回归，确认原生修复覆盖这些场景后再移除补丁。

## 正式版本与预发布版本

用户可见的包变更通过 `pnpm change` 添加中文 change intent，版本准备保留原生 `pnpm version -r` 入口。公开包、私有包及根包均参与版本计算；私有示例可能因直接或多级工作区依赖传播而更新版本，包含公开包和私有包的同一 changeset 也应正常处理。实际发布候选和发布 PR 的公开包说明校验仅针对可发布包，私有包不会上传到 npm。

`release.yml` 在 `main` 处理正式发布，在 `alpha`、`beta`、`rc`、`next` 处理对应预发布。版本 PR 合并后，repoctl 校验发布来源、构建并发布 npm 包，再完成 Git tag、GitHub Release 和发布记录。npm 使用可信发布及 provenance；工具链或文档迁移本身不创建虚假的包 changeset，也不重新发布已有版本。

不要恢复只选择公开目录的版本计算：这会使混合 changeset 中的私有包无法识别。上游实现见 [repoctl#1026](https://github.com/icelib/repoctl/pull/1026)。

## Nightly 快照

同一个 `release.yml` 每天 `00:00 UTC`（北京时间 08:00）从 `main` 运行 nightly，也可在 `main` 手动选择 `mode=nightly`。快照使用 repoctl 原生 npm dist-tag **`snapshot-nightly`**：

```bash
pnpm add @weapp-sqlite/weapp-vite@snapshot-nightly
# 需要开发工具时使用同一通道
pnpm add -D @weapp-sqlite/devtools@snapshot-nightly
```

nightly 不消耗 changeset、不修改仓库中的正式版本、不推进 `latest`，也不会触发正式文档发布。repoctl 根据来源提交及 CI 构建身份生成快照版本，在隔离源码中构建、校验包及内部依赖后发布公开包；私有工作区只参与构建。恢复同一次失败构建时保留原构建身份和发布证据，新的构建使用新的身份。

隔离源码由 Git archive 导出，不包含 `.git`。根 `prepare` 只在本地 Git checkout 中安装 Lefthook，CI、显式禁用 hooks 或源码归档会跳过安装；依赖安装和包构建仍正常执行。若 nightly 在上传前失败，先根据诊断报告和 npm registry 确认是否已有包上传，再决定重试路径。

`pnpm check:publish` 除仓库元数据和文件清单外，还调用 repoctl 的实际包检查，验证 tarball、ESM/CommonJS 类型声明及独立消费者安装。CI 在 Ubuntu Node 24 中执行同一检查，避免到 nightly 上传前才发现发布产物问题。

首次启用前，确认所有九个公开 npm 包的可信发布配置允许本仓库的 `release.yml`。仅设置 GitHub 的 `NPM_TRUSTED_PUBLISHING` 变量不能替代 npm 侧授权。2026-10-23 已通过 npm 包设置逐项核对：九个包均绑定 `weapp-sqlite/weapp-sqlite` 的 `release.yml`，状态 Valid，允许 `npm publish`，未限制 environment。

## 发布来源与回归

已有 `.changeset/ledger.yaml` 记录的版本，以记录首次进入主线的提交识别发布来源。首次发布可能沿用包创建时的版本号，因此不能把 manifest 最早出现该版本的开发提交当作发布提交。没有账本记录的依赖传播版本保留 manifest 历史回退。

来源发现使用 Git 第一父提交历史，普通合并时选择主线合并提交。后续 CI 修复和其他包的账本更新不会改变来源。尚未提交的发布记录会被拒绝；manifest 名称、版本和 CHANGELOG 内容仍须与来源一致，删除当前 CHANGELOG 也不能跳过验证。CI 和发布工作流必须保留完整 Git 历史。

`pnpm test:release` 通过已安装的 repoctl 公共入口、真实临时 Git 仓库和禁止远程写入的适配器验证上述行为，包含真实 DevTools 首发历史的回归。版本准备集成测试使用仓库固定的 pnpm 12.14.0，覆盖公开包到多级私有包的依赖传播和混合 changeset；GitHub 写入、远端 push 及 npm 发布由测试适配器拦截。升级 repoctl 后必须继续通过这些测试，不跳过或降低来源校验。

`pnpm validate` 执行完整项目校验。网站另使用 `pnpm docs:build` 和 `pnpm docs:test`；CI 保留 Node 22/24 三平台测试与 Web acceptance。

## 发布失败后的恢复

先核对 npm 精确版本、dist-tag、Git tag、GitHub Release 和 checkpoint，确认失败阶段。修复脚本后用最新代码运行，重跑旧 run 仍会使用旧代码。npm 元数据不一定提供 `gitHead`；应同时核验 checkpoint 和 Git tag 的原始发布来源。

已合并版本 PR、没有待处理 changeset 时，显式选择 `publish` 模式；普通修复提交可能被 `auto` 的触发过滤跳过。若发布工具修复晚于原版本提交，还应传入完整 `source-sha`，由当前工具在原提交的临时 checkout 中构建发布，使构建内容和 Git tag 保持原始来源：

```sh
# 预览来源和待处理版本，不写远端；需要 GitHub 只读权限。
pnpm exec repo release ci --mode publish --dry-run

# RELEASE_SOURCE_SHA 为已核验的版本 PR 合并提交完整 SHA。
gh workflow run release.yml --repo weapp-sqlite/weapp-sqlite --ref main -f mode=publish -f source-sha="$RELEASE_SOURCE_SHA"
```

预演可能列出 checkpoint 已完成的包；应检查 npm 状态完成、没有缺失 tag 或发布元数据，而不是要求候选列表为空。已完成的发布无需重新发布。

工作流保存存在的 `repoctl-release-progress.json`、`repoctl-publish-progress.json`、`repoctl-ci-progress.json` 和 `pnpm-publish-summary.json`。nightly 另保留快照、消费者验证报告及 tarballs。不要删除 checkpoint、伪造版本或跳过来源验证来重试；应从失败运行的 artifacts 和日志确认后续动作。

## 网站通道与首次上线

repoctl 的 `website` 站点由两个工作流管理：`repoctl-docs.yml`（Documentation）接收主线更新或手动输入，调用 `repoctl-docs-deploy.yml` 在对应环境中确定来源、构建、验证并部署产物。稳定发布完成后也调用同一个部署工作流。

| 通道      | 来源                     | 域名                       | GitHub environment     |
| --------- | ------------------------ | -------------------------- | ---------------------- |
| `preview` | `main` 最新提交          | `preview.sqlite.weapp.dev` | `docs-website-preview` |
| `stable`  | 完整稳定发布记录中的源码 | `sqlite.weapp.dev`         | `docs-website-stable`  |

预览站显示未发布版本提示并禁止搜索引擎收录。正式站不直接跟随 `main`。当前迁移不伪造历史发布基线；首个 repoctl 6 完整稳定发布建立正式站基线，此前保留已有正式站。文档修补也通过 Documentation 工作流，在稳定基线上选择允许的文档提交，不将 `main` 的未发布代码混入正式站。

远端启用顺序：

1. 确认两个 GitHub environments 仅允许 `main` 部署。`CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 可使用对本仓库开放的组织级或仓库级 secrets，由调用工作流通过 `secrets: inherit` 传入；也可在对应 environment 中配置，同名 environment secret 优先。`CLOUDFLARE_ACCOUNT_ID` 还支持 variable，但工作流优先读取 secret。继承凭据不改变 environment 的 `main` 部署限制。Token 需具备目标账号的 Workers 部署及 `weapp.dev` 自定义域名所需权限。
2. 先在 Cloudflare Dashboard 断开旧 `weapp-sqlite-docs` 的 Workers Builds Git 连接，避免 `main` 和非生产分支绕过稳定基线更新正式站。不要只依赖 Disable builds 开关；本次迁移中开关开启后仍发生了旧构建。断开 Git 连接不删除当前部署或域名。
3. 再启用预览流程，确认预览 Worker `weapp-sqlite-docs-preview` 和 `preview.sqlite.weapp.dev` 的域名配置，验证预览工作流、首页、深层文档、搜索和禁止收录行为。
4. 待下一次完整稳定发布建立基线，通过 repoctl 部署正式 Worker `weapp-sqlite-docs`，确认 `sqlite.weapp.dev` 的来源和页面，再将此流程作为唯一正式部署入口。

截至 2026-10-23，两个 GitHub environments 已创建并限制为 `main`；组织级 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN` secrets 已配置并对本仓库开放，通过工作流继承接入。已有的 environment `CLOUDFLARE_ACCOUNT_ID` variable 作为回退，组织级同名 secret 优先于该 variable。旧 Workers Builds Git 连接已断开，控制台已恢复为“连接”入口。迁移 PR 的两次旧构建曾覆盖正式站，均已回滚；正式站已核验恢复到迁移前版本 `59d35450-8569-4472-aae9-9e968ef37713`，承载 100% 流量。预览站已由 [Documentation #39948826846](https://github.com/weapp-sqlite/weapp-sqlite/actions/runs/39948826846) 完成首次受管部署，来源为 `9759d43d354359e905a45a83c92275bfcc3d5644`；首页、文档、搜索、Markdown、OG、404 和禁止收录均已线上核验。过期的预览重试已被主线前进检查拦截，没有覆盖新站点；同一部署身份重跑成功返回 skipped，没有重复上传。nightly 发布和消费者安装仍待验收。详细检查见[静态部署指南](https://sqlite.weapp.dev/docs/deployment/)。

## 网站恢复

稳定部署失败时，重试 Documentation 工作流并指定原完整发布记录 ID，无需重新发布 npm 包：

```sh
# STABLE_RELEASE_ID 为 repoctl 已完成的稳定发布记录 ID。
gh workflow run repoctl-docs.yml --repo weapp-sqlite/weapp-sqlite --ref main -f site=website -f channel=stable -f release="$STABLE_RELEASE_ID"
```

Documentation 的手动输入包括 `site`、`channel`、`source-sha`、`release` 和 `commits`。预览使用 `source-sha` 选择主线来源；正式文档修补使用 `release` 指定稳定基线，并在 `commits` 中传入空格分隔的、已进入主线的单父文档提交。当前允许修补 `apps/docs/content/docs` 下的 Markdown/MDX，以及 `apps/docs/public` 下的图片；配置、依赖和应用代码不属于修补范围。repoctl 会校验其允许范围，不能靠修改部署 hook 绕过校验。

根脚本 `docs:deploy:preview` 和 `docs:deploy:stable` 仅供 repoctl 部署阶段调用，要求已有构建产物及匹配的来源身份；不要从当前工作目录直接裸跑以替代工作流。恢复时保留工作流日志、计划和部署记录，用它们核对源码、渠道和目标 Worker。

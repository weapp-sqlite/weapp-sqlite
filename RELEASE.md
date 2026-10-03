# 发布维护与恢复

本仓库使用 `repoctl@^5.7.1`，锁文件解析为 `5.7.1`。该版本已经包含首次发布的账本来源识别、第一父提交历史和 CHANGELOG 对称校验，因此不再维护 `@icebreakers/monorepo@5.6.0` 本地补丁。

## 工作区版本与发布范围

版本准备保留原生 `pnpm version -r` 入口。公开包、私有包及根包均参与版本计算；私有示例可能因直接或多级工作区依赖传播而更新版本，包含公开包和私有包的同一 changeset 也应正常处理。实际发布候选和发布 PR 的公开包说明校验仅针对可发布包，私有包不会上传到 npm。

上游最终实现见 [repoctl#1026](https://github.com/icelib/repoctl/pull/1026)。原先仅选择公开包目录的方案 [repoctl#1025](https://github.com/icelib/repoctl/pull/1025) 已关闭而未合并：过滤工作区会使混合 changeset 中的私有包无法识别，不应恢复该过滤逻辑。

此次迁移仅升级工具依赖、兼容配置和回归测试，不进行根资产模板同步，不修改公开 API，也不重新发布已有版本。后续用户可见的包变更仍使用 `pnpm change` 并填写中文说明。

## 发布来源与回归

已有 `.changeset/ledger.yaml` 记录的版本，以记录首次进入主线的提交识别发布来源。首次发布可能沿用包创建时的版本号，因此不能把 manifest 最早出现该版本的开发提交当作发布提交。没有账本记录的依赖传播版本保留 manifest 历史回退。

来源发现使用 Git 第一父提交历史，普通合并时选择主线合并提交。后续 CI 修复和其他包的账本更新不会改变来源。尚未提交的发布记录会被拒绝；manifest 名称、版本和 CHANGELOG 内容仍须与来源一致，删除当前 CHANGELOG 也不能跳过验证。CI 和发布工作流必须保留完整 Git 历史。

`pnpm test:release` 通过已安装的 repoctl 公共入口、真实临时 Git 仓库和禁止远程写入的适配器验证上述行为，包含真实 DevTools 首发历史的回归。版本准备集成测试使用真实 pnpm 12.8.1，覆盖公开包到多级私有包的依赖传播和混合 changeset；GitHub 写入、远端 push 及 npm 发布由测试适配器拦截。CI 的 Node 22/24 三平台矩阵和 Release 工作流均执行这些回归。升级 repoctl 后必须继续通过这些测试，不跳过或降低来源校验。

## 发布失败后的恢复

先核对 npm 精确版本、dist-tag、Git tag、GitHub Release 和 checkpoint，确认失败阶段。修复脚本后用最新代码运行，重跑旧 run 仍会使用旧代码。npm 元数据不一定提供 `gitHead`；应同时核验 checkpoint 和 Git tag 的原始发布来源。

已合并版本 PR、没有待处理 changeset 时，显式选择 `publish` 模式；普通修复提交可能被 `auto` 的触发过滤跳过。若发布工具修复晚于原版本提交，还应传入完整 `source_sha`，由当前工具在原提交的临时 checkout 中构建发布，使构建内容和 Git tag 保持原始来源：

```sh
# 在持有 GitHub 只读权限的环境中预览来源和待处理版本，不写远端。
pnpm exec repo release ci --mode publish --dry-run

# 验证通过后，在受信任的 GitHub Actions 环境中继续发布。
# 将 RELEASE_SOURCE_SHA 设置为已核验的版本 PR 合并提交完整 SHA。
gh workflow run release.yml --repo weapp-sqlite/weapp-sqlite --ref main -f mode=publish -f source_sha="$RELEASE_SOURCE_SHA"
```

预演可能列出 checkpoint 已完成的包；应检查 npm 状态完成、没有缺失 tag 或发布元数据，而不是要求候选列表为空。已完成的发布无需重新发布。

发布失败时，工作流保存存在的 `repoctl-release-progress.json`、`repoctl-publish-progress.json` 和 `pnpm-publish-summary.json`。不要删除 checkpoint、伪造版本或跳过来源验证来重试。

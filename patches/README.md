# repoctl 发布兼容补丁

`@icebreakers/monorepo@5.6.0.patch` 修复当前 repoctl 的两处发布边界问题。

- `pnpm version -r` 只选择本仓库 `packages/*` 下的公开包，避免私有示例进入发布计划。上游实现见 [repoctl#1025](https://github.com/icelib/repoctl/pull/1025)。
- 对已有 `.changeset/ledger.yaml` 记录的版本，以记录首次进入主线的提交识别发布来源。首次发布可能沿用包创建时的版本号，因此不能把 manifest 最早出现该版本的开发提交当作发布提交。没有账本记录的依赖传播版本保留 manifest 历史回退。

来源发现使用 Git 第一父提交历史，普通合并时选择主线合并提交。后续 CI 修复和其他包的账本更新不会改变来源。尚未提交的发布记录会被拒绝；manifest 名称、版本和 CHANGELOG 内容仍须与来源一致，删除当前 CHANGELOG 也不能跳过验证。

`pnpm test:release` 通过已安装的 repoctl 公共入口、真实临时 Git 仓库和禁止远程写入的适配器验证这些行为，包含真实 DevTools 首发历史的回归。CI 的 Node 22/24 三平台矩阵和 Release 工作流均执行它。升级 repoctl 时先确认上游已包含两项修复，再移除补丁，并保留回归测试。

## 发布失败后的恢复

先核对 npm 精确版本、dist-tag、Git tag、GitHub Release 和 checkpoint，确认失败阶段。修复脚本后用最新代码运行，重跑旧 run 仍会使用旧代码。

已合并版本 PR、没有待处理 changeset 时，显式选择 `publish` 模式；普通修复提交可能被 `auto` 的触发过滤跳过。若发布工具修复晚于原版本提交，还应传入完整 `source_sha`，由当前工具在原提交的临时 checkout 中构建发布，保持 npm `gitHead` 与 Git tag 来源一致：

```sh
# 在持有 GitHub 只读权限的环境中预览来源和待处理版本，不写远端。
pnpm exec repo release ci --mode publish --dry-run

# 验证通过后，在受信任的 GitHub Actions 环境中继续发布。
# 将 RELEASE_SOURCE_SHA 设置为已核验的版本 PR 合并提交完整 SHA。
gh workflow run release.yml --repo weapp-sqlite/weapp-sqlite --ref main -f mode=publish -f source_sha="$RELEASE_SOURCE_SHA"
```

发布失败时，工作流保存存在的 `repoctl-release-progress.json`、`repoctl-publish-progress.json` 和 `pnpm-publish-summary.json`。不要删除 checkpoint、伪造版本或跳过来源验证来重试。

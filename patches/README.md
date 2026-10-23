# repoctl 6.0.1 历史发布恢复补丁

`@icebreakers__monorepo@6.0.1.patch` 修复 `repoctl@6.0.1` 的实际实现依赖
`@icebreakers/monorepo@6.0.1`。两个包的版本均保持不变，补丁由 pnpm 的
`patchedDependencies` 和 lockfile 固定。

原始实现有两个可以用本仓库发布提交重现的问题：

- `release ci --stage plan --source-sha ...` 创建包管理器目录后，`verify`
  再次创建同一目录并抛出 `EEXIST`。目录初始化现在可以重复执行。
- 冻结的 v5 配置含 `tooling.lintStaged`，v6 在恢复时加载配置会拒绝该字段。
  现在仅历史来源恢复的配置读取可以忽略这个废弃字段。其他字段、类型和
  配置冲突仍正常校验，当前工作区仍拒绝 `lintStaged`，两种读取的缓存独立。
  单次恢复、分阶段恢复以及完成记录的配置读取遵循同一规则。

补丁不修改历史 checkout，不跳过源码、版本或 CHANGELOG 校验，也不允许
`tooling.husky` 等其他废弃字段。正常版本发布与 nightly 不启用历史配置兼容。

运行 `pnpm test:release` 验证。新增回归从真实 DevTools 首发提交读取原始配置，
让六个阶段分别运行在新的 Node 进程中，并覆盖阶段重试、单次恢复和严格校验。
Git 使用临时真实仓库；安装、构建与远端发布均由测试适配器拦截，provider
checkpoint 只写入该测试的临时目录。

升级 repoctl 时，先确认上游修复这两个恢复问题，再删除补丁并更新 lockfile。
只有不依赖补丁也能通过全部发布回归时，才移除 `patchedDependencies`。

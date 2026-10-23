# repoctl 6.0.1 发布恢复与包入口解析补丁

`@icebreakers__monorepo@6.0.1.patch` 修复 `repoctl@6.0.1` 的实际实现依赖
`@icebreakers/monorepo@6.0.1`。两个包的版本均保持不变，补丁由 pnpm 的
`patchedDependencies` 和 lockfile 固定。

原始实现有以下可以用本仓库发布及包声明重现的问题：

- `release ci --stage plan --source-sha ...` 创建包管理器目录后，`verify`
  再次创建同一目录并抛出 `EEXIST`。目录初始化现在可以重复执行。
- 冻结的 v5 配置含 `tooling.lintStaged`，v6 在恢复时加载配置会拒绝该字段。
  现在仅历史来源恢复的配置读取可以忽略这个废弃字段。其他字段、类型和
  配置冲突仍正常校验，当前工作区仍拒绝 `lintStaged`，两种读取的缓存独立。
  单次恢复、分阶段恢复以及完成记录的配置读取遵循同一规则。
- 包消费者入口解析将 exports 条件中的 `null` 当作没有匹配，错误继续选择
  `default`。现在条件对象中的 `null` 会终止匹配；数组遵循 Node 的回退规则，
  空数组及最终只匹配到 `null` 的数组阻止该入口，`[null, "./valid.js"]` 仍选择
  后面的有效目标。包检查、快照准备和 nightly 发布后的消费者验证共用此解析。

补丁不修改历史 checkout，不跳过源码、版本或 CHANGELOG 校验，也不允许
`tooling.husky` 等其他废弃字段。正常版本发布与 nightly 不启用历史配置兼容。

运行 `pnpm test:release` 验证。新增回归从真实 DevTools 首发提交读取原始配置，
让六个阶段分别运行在新的 Node 进程中，并覆盖阶段重试、单次恢复和严格校验。
Git 使用临时真实仓库；安装、构建与远端发布均由测试适配器拦截，provider
checkpoint 只写入该测试的临时目录。

`pnpm test:automation` 的包入口回归使用真实 Node import/require 核对上述条件，
再通过 repoctl 公共入口实际打包、安装和类型检查。被 `node: null` 排除的运行时
仍检查 ESM/CJS 声明，合法 Node 入口仍执行，真实运行时异常仍导致校验失败。
这使依赖 Vite 虚拟模块的入口能准确声明环境边界，无需跳过消费者校验。

升级 repoctl 时，先确认上游修复这些恢复与入口解析问题，再删除补丁并更新 lockfile。
只有不依赖补丁也能通过全部发布回归时，才移除 `patchedDependencies`。

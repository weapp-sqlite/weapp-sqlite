# repoctl 6.0.1 发布与消费者校验补丁

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
- nightly 的隔离消费者使用 pnpm 默认发布时间限制，可能将新发布的标签
  回退到旧版本。现在仅为已确认批次的精确 `包名@版本` 设置
  `minimumReleaseAgeExclude`，保留第三方依赖的默认策略。
- 标签是可变入口，精确版本端点与 install-v1 的确认不覆盖 pnpm 根据
  发布时间策略读取的完整整包元数据。现在消费者直接安装已确认批次的
  精确版本；确认逻辑用 pnpm 实际 Accept 请求头读取完整和简略整包元数据，
  核对标签、版本及 tarball 身份，消费后再次严格检查。安装后的精确版本与
  批次身份校验保持不变，真正的 tarball、类型或运行时错误仍导致失败。
  原失败报告没有保留历史完整整包响应，不能据此断言那次响应的具体内容。

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

同一命令也测试真实安装模块中的 nightly 确认与消费者函数，覆盖元数据等待、
身份冲突、消费后标签漂移和精确发布年龄豁免。ESM/CJS 入口及 TypeScript
声明检查实际执行，错误样例必须失败；registry 写入和依赖安装由适配器拦截。

升级 repoctl 时，先确认上游修复这些恢复、入口解析与 nightly 一致性问题，再删除补丁并更新 lockfile。
只有不依赖补丁也能通过全部发布回归时，才移除 `patchedDependencies`。

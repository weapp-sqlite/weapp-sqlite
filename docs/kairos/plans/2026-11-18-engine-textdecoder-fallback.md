---
title: 'WASM 引擎恢复 TextDecoder 降级路径 · 实施计划'
doc-type: plan
version: v0.14
date: 2026-11-18
slug: 'engine-textdecoder-fallback'
base: 'main'
---

## Constraints

- 产物只能由 Docker 重建（镜像 `weapp-sqlite-sqljs:1.14.2-emscripten-5.0.0`）；`packages/sqljs/src/vendor/*` 禁止手工编辑。
- 构建输入的差异只表达在 `packages/sqljs/docker/*.patch`；Dockerfile 不追加 `sed`/`cat` 式产物后处理。
- 禁止手工编辑 `packages/sqljs/src/vendor/manifest.json` 的 sha256 / bytes；只能由 `scripts/update-lite-manifest.mjs` 在重放后重算。
- 不改 `globalThis`、不新增 `@weapp-sqlite/sqljs/textdecoder` 子路径、不在 `@weapp-sqlite/debug` 增加缺 `TextDecoder` 诊断。
- `@weapp-sqlite/core` 不引入宿主 API；本次不触碰 core。
- 断言以符号与形态为据，不以行号或 minified 名称为据。
- 体积阈值变更必须显式记录，禁止为了让门禁变绿直接改数字。
- patch 面的行尾由 `.gitattributes` 的 `*.patch text eol=lf` 钉住：`manifest.json` 的 `patches` 段记的是 LF 字节的 sha256，任何把 patch 转成 CRLF 的检出（Git for Windows 默认 `core.autocrlf=true`，CI 的 `windows-latest` 腿亦为该默认）都会让 `verify:lite` 在完好已提交产物上报 `does not match manifest.json.`；该行由 Task 4 落地。
- 历史红基线（已消除，不是当前状态）：`verify:lite` 曾在干净 HEAD 上因 manifest 陈旧（`sqljs-reliability.patch` 记录 `e9772269…` vs 实际 `b0b4380e…`，自 `922d7e8` 起）以 exit 1 结束；该失配已由 Task 2 的重放消除，manifest 现记 `28ffe3ff…`，与 `shasum -a 256 packages/sqljs/docker/sqljs-reliability.patch` 一致，当前 HEAD 上 `verify:lite` exit 0。与 spec 的 Constraints `manifest 陈旧（历史缺陷，已由重放消除）` 与 A2 同口径——`verify:lite` 此后是常规绿门禁，不再有任何豁免。
- 每个任务只提交一次（conventional commit），该次提交就是任务的唯一落定；只读证据与可还原探针可以排在它之后——`git clone` 只取 HEAD，留在工作树里的未提交改动在克隆内不可见，故 Task 4 的唯一提交前移到它的克隆复验之前。

### Task 1: 产物守卫断言与 `verify:engines` 入口

#### Objective

新增 `packages/sqljs/scripts/verify-engines.mjs`，用**结构断言**判定三份 glue 是否硬依赖宿主 `TextDecoder`；把既有 `verify:engines` 别名从 `verify-lite.mjs` 改指到它；并让 `rebuild-engines.sh` 在重放后调用它。任务在未修复的现有产物上**必须以红结束**——这条红就是本任务的验收证据。

#### Files

- `packages/sqljs/scripts/verify-engines.mjs`（新建）
- `packages/sqljs/package.json`（`scripts.verify:engines`，当前值为 `node ./scripts/verify-lite.mjs`）
- `packages/sqljs/scripts/rebuild-engines.sh`（在 `update-lite-manifest.mjs` 与 `verify-lite.mjs` 之间插入调用）

#### Consumes

- `packages/sqljs/src/vendor/sql-wasm.js`、`sql-wasm-lite.js`、`sql-wasm-browser.js`（当前均为 `TEXTDECODER=2` 产物：`globalThis.TextDecoder` 出现 0 次、`new TextDecoder` 各 1 处且无守卫）

#### Produces

- 命令 `pnpm --filter @weapp-sqlite/sqljs verify:engines`
- 对每份产物逐条报出「未守卫的解码器构造（`new TextDecoder` 与 `new globalThis.TextDecoder` 两种拼写）」并以 exit 1 结束

#### Steps

- 写 `verify-engines.mjs`：遍历三份 glue，断言「每一处解码器构造（`new TextDecoder` 与 `new globalThis.TextDecoder` 两种拼写，与 spec D3/A1 及已入库的 `packages/sqljs/scripts/verify-engines.mjs:15` 同一匹配面）都必须与 `globalThis.TextDecoder` 守卫出现在同一表达式内且相邻」且「每份产物至少一处守卫构造」；任一份不满足则打印 `文件名 + 断言名` 并以 exit 1 结束 — checkable: `node --check packages/sqljs/scripts/verify-engines.mjs` 退出 0
- 在当前未修复产物上运行该脚本 — checkable: exit 1，且输出恰好列出三份产物各一条未守卫构造
- 改 `package.json` 的 `verify:engines` 指向 `./scripts/verify-engines.mjs`（不新增别名） — checkable: `pnpm --filter @weapp-sqlite/sqljs verify:engines` 退出 1 且输出与上一步一致
- 在 `rebuild-engines.sh` 的 `update-lite-manifest.mjs` 之后、`verify-lite.mjs` 之前插入 `node "$package_root/scripts/verify-engines.mjs"` — checkable: 该文件内两者的行序为 manifest → engines → lite
- 提交（`test(sqljs): 新增产物 TextDecoder 守卫断言`）

#### Acceptance

- 命令存在且在三份未修复产物上以 exit 1 结束，报错能指名到具体文件与断言。
- 脚本不读取任何外部参考形态文件（无 fixture、不访问网络、不依赖 Docker）。
- `verify-lite.mjs` 未被改动，职责仍为体积预算 + manifest 完整性。

#### DependsOn

none

### Task 2: `-s TEXTDECODER=1` 构建参数与三变体重建

#### Objective

在 `packages/sqljs/docker/sqljs-reliability.patch` **新增**一个 Makefile hunk，向 sql.js v1.14.2 `Makefile` 的 `EMFLAGS_OPTIMIZED` 追加 `-s TEXTDECODER=1`，重建三份产物并重算 manifest，使 Task 1 的断言转绿。

#### Files

- `packages/sqljs/docker/sqljs-reliability.patch`（当前只有 `src/api.js` 与 `src/exported_functions.json` 两段）
- `packages/sqljs/src/vendor/sql-wasm.js`、`sql-wasm-lite.js`、`sql-wasm-browser.js`（重建产物）
- `packages/sqljs/src/vendor/manifest.json`（重算）

#### Consumes

- Task 1 的 `verify-engines.mjs` 与改指后的 `verify:engines` 入口
- 上游 `Makefile` 的 `EMFLAGS_OPTIMIZED`（`-Oz` / `-flto` / `--closure 1` 三行）
- `docker/sqljs-lite.patch` 全部三条 Makefile hunk（`@@ -21,10 +21,7 @@` `SQLITE_COMPILATION_FLAGS` 段、`@@ -64,7 +61,7 @@` `EMFLAGS_DEBUG` 段、`@@ -187,7 +184,7 @@` 规则段）

#### Produces

- 三份 glue 均为 `TEXTDECODER=1` 形态：`globalThis.TextDecoder && new TextDecoder()`
- `manifest.json` 的三份 artifact 摘要与 sha256 与重建结果一致

#### Steps

- 在 `sqljs-reliability.patch` 追加一段 Makefile hunk：`-Oz \` 行之后插入 `-s TEXTDECODER=1 \`，上下文取 `EMFLAGS_OPTIMIZED= \` / `-flto \` / `--closure 1` — checkable: `grep -c "^--- a/Makefile" packages/sqljs/docker/sqljs-reliability.patch` 为 1，且该段含 `-s TEXTDECODER=1`
- 校验新 hunk 在**旧文件**上覆盖的行区间与 lite patch 三条 Makefile hunk 的旧行区间（`21–30`、`64–70`、`187–193`，对应 `@@ -21,10 …`、`@@ -64,7 …`、`@@ -187,7 …`）**均不相交**——按位置判据比对，不按上下文行内容比对：上游 Makefile 的 `-Oz \` 出现两次（旧行 21 与 59），空行亦重复，内容比对必然误判为相交；新增 hunk 锚在 `EMFLAGS_OPTIMIZED` 定义处，旧行区间须整体落在空档 `31–63` 内（如 `@@ -57,7 …` 覆盖旧行 57–63） — checkable: 从新 hunk 的 `@@ -a,b` 推出旧行区间 `a..a+b-1`，其与 `21–30`、`64–70`、`187–193` 的交集为空；权威验证是在 Docker 内按 reliability → lite 顺序真实二次应用，`rebuild:engines` 失败即本步不通过
- 跑 `pnpm --filter @weapp-sqlite/sqljs rebuild:engines` — checkable: exit 0，且 manifest 由 `update-lite-manifest.mjs` 重写（`git diff --stat` 含该文件）
- 跑 `pnpm --filter @weapp-sqlite/sqljs verify:engines` — checkable: exit 0
- 记录体积：从 `manifest.json` 读出三份 artifact 的 `bytes` 并跑 `verify:lite` — checkable: `verify:lite` exit 0；仅当 exit 1 的原因确为体积超阈时，才允许按 D4 把实测值与阈值来源写进本任务的提交信息、并由 Task 3 的 PR 正文要素清单承接、等待作者裁决后重跑至 exit 0（**不得直接改阈值**）；其余任何 exit 1（含 manifest 摘要失配等非体积原因）一律判定本步失败
- 跑 `pnpm --filter @weapp-sqlite/sqljs test` 与 `pnpm --filter @weapp-sqlite/wasm test` — checkable: 两者 exit 0
- 提交（`fix(sqljs): 恢复 TEXTDECODER=1 降级路径`）

#### Acceptance

- 三份产物均满足 Task 1 的结构断言（`verify:engines` exit 0）。
- `verify:lite` exit 0，且因 manifest 陈旧导致的既有失配已随重放消失。
- 未出现对 `src/vendor/*` 的手工编辑；三份产物的 `globalThis.TextDecoder` 出现次数均 ≥ 1。
- 体积实测值被记录（本任务的提交信息，Task 3 的 PR 正文要素清单承接），任何阈值调整都附一行来源说明。

#### DependsOn

1

### Task 3: 发布语义与收口

#### Objective

以 patch 级 changeset 记录 `@weapp-sqlite/sqljs` 面向用户的行为变化（中文摘要 + 解码边界一行），并把 PR 正文要素清单（条目名 + spec 标注 + 实际值）固化在提交信息正文这一任务内可核验载体，逐条对应 spec 的 D4 / D6 / A7 / A6 / D5，并另登记 `turbo.json` 环境回填（提交 `3288a76`）为清单第六项；changeset 正文就是 changelog entry（`pnpm change --summary` 自述 "the summary for the changelog entry"），发布时逐字进入 `packages/sqljs/CHANGELOG.md` 与 GitHub release 正文，故不承载清单；PR 由 close 阶段按该清单组装，本任务不创建 PR。

#### Files

- `.changeset/` 下由 `pnpm change` 生成的 changeset 文件（一处）
- `turbo.json`（已交付的环境回填，提交 `3288a76`：`"agentGuidance": false`）——本任务不改动该文件，只把它登记为 PR 正文要素清单的第六项，使 diff 里的这一行有归属

#### Consumes

- Task 2 的产物变化与体积实测值
- `.changeset/ledger.yaml` 现有的 patch 级惯例（如 `@weapp-sqlite/sqljs@0.3.1` 条目）

#### Produces

- 一条 patch 级 changeset，仅涉及 `@weapp-sqlite/sqljs`
- A7 的引用面：issue #23 的病根更正评论 permalink（`#issuecomment-6972987823`）与 D5 标题文本写进提交信息正文；changeset 正文若提及 issue #23，只用普通发布说明措辞并附同一 permalink，不出现 `A7` / `D5` 标注——close 阶段据提交信息组装 PR，使 A7 可离线复核（本会话执行 D5，本任务只确认与引用，不重复执行）
- PR 正文要素清单：五项 spec 条目名（D4 / D6 / A7 / A6 / D5）与一项无 spec 条目的环境回填（`turbo.json`）连同实际值全部落在本任务的提交信息正文（`git log -1 --format=%B` 可核验），changeset 正文保持面向用户的两行、不含清单

#### Steps

- 跑 `pnpm change`，包选 `@weapp-sqlite/sqljs`、级别 patch、摘要用中文写明「恢复宿主缺少 `TextDecoder` 时的降级路径」，并按 spec D6 另起一行写明解码边界：非合法 UTF-8 的 ≤ 16 字节 TEXT 值不再由宿主 `TextDecoder` 展开、可能落到 U+0000、以 -1 长度绑回时被截断为空值，而 `TEXTDECODER=2` 存下 U+FFFD；changeset 正文到此为止，不追加清单或 spec 标注 — checkable: 新 changeset 文件的 front matter 只含该包且级别为 patch，正文含这一行解码边界（`U+0000` 与 `U+FFFD` 字样均出现），且正文不含 `D4` / `D6` / `A7` / `A6` / `D5` 标注与 `gh api` 内部命令
- 跑 `pnpm validate` — checkable: exit 0，且跑完后 `git status --porcelain AGENTS.md` 为空（自提交 `3288a76` 起 `turbo.json:3` 为 `"agentGuidance": false`，turbo 不再写回 `<!-- BEGIN:turborepo-agent-rules -->` 托管块；v0.8 曾要求的 `git checkout -- AGENTS.md` 因此是死动作，已删）
- 确认并引用 issue #23 已按 D5 更新：标题为 `[Bug]: -Oz 使 TEXTDECODER=2，iOS JSC 实例化即 ReferenceError`，评论 `#issuecomment-6972987823` 正文含三层因果链与判定依据（本会话已执行，本步只读确认，不重复写入）——所有 gh 命令**显式钉 `--repo weapp-sqlite/weapp-sqlite`**：本 clone 的 `origin` 指向 `Oscaner/weapp-sqlite`，该镜像仓库的 issues 已关闭，不钉 `--repo` 时命令默认解析到 `origin` 并以 exit 1 结束，与本步骤的可达性无关 — checkable: `gh issue view 23 --repo weapp-sqlite/weapp-sqlite --json title,comments` 的 title 与 D5 文案逐字一致，且 comments 含该 permalink 对应的病根链正文；若该命令仍不可达（网络、鉴权或仓库不可读），本步以 blocked 结束并在本轮 handoff 与提交信息写明原因，**不记通过**
- 固化 PR 正文要素清单（close 阶段按此清单组装 PR，本计划不创建 PR，故本任务的交付物是清单本身而不是 PR 描述）：把下列六项按顺序连同实际值写进 step 5 的提交信息正文——①体积实测值（spec D4，来自 Task 2）；②解码边界一行（spec D6，与 changeset 摘要同一措辞：非合法 UTF-8 的 ≤ 16 字节 TEXT 值可能落到 U+0000、以 -1 长度绑回时被截断为空值，`TEXTDECODER=2` 存 U+FFFD）；③issue #23 的病根更正评论 permalink `#issuecomment-6972987823` 与 D5 标题文本（spec A7 的引用对象，须可离线复核）；④真机 iOS 回归待确认，不把 A6 标为通过（spec A6，非 CI 门禁）；⑤spec D5 承接的发布后义务：`@weapp-sqlite/sqljs` 发布后回到 issue #23 补一条点名本次发布版本号的版本说明，该 issue 在 A6 真机确认前保持 open，核验面为 `gh api repos/weapp-sqlite/weapp-sqlite/issues/23/comments --jq '.[].body'`（发布动作不在本计划任何任务内，故此处只作待办登记，不新增只能在发布后完成的步骤）；⑥环境回填：`turbo.json` 的 `"agentGuidance": false`（提交 `3288a76`，无 spec 条目——登记目的是让 PR 读者把 diff 里这一行映射到一条条目，并说明它关闭了 turbo 对 `AGENTS.md` 托管块的自动写入）；changeset 正文保持 step 1 的两行不动 — checkable: `git log -1 --format=%B` 含六项条目名（五项 spec 标注 `D4` / `D6` / `A7` / `A6` / `D5` 加一项无标注的 `turbo.json` 回填）连同实际值，且标题文本与 D5 文案逐字一致、解码边界一行含 `U+0000` 与 `U+FFFD`、发布后待办一行含 `@weapp-sqlite/sqljs` 与版本号的措辞及该 `gh api` 命令；`gh pr list --repo weapp-sqlite/weapp-sqlite --head fix/engine-textdecoder-fallback --state all` 输出 `[]`，确认本任务未创建 PR（这条负向确认必须显式钉 `--repo`：镜像 `Oscaner/weapp-sqlite` 对 PR 列表不应答 404 而以 exit 0 返回空数组，不钉时它无论在跟踪仓库是否已有该分支的 PR 都给出 `[]`，等于什么都不测——与 step 3 的 issues 命令失效面不同，同类「看似通过」的负向确认不得再写）
- 提交（`chore(changeset): 记录 sqljs 的 TEXTDECODER 降级修复`）

#### Acceptance

- changeset 为 patch 级、仅含 `@weapp-sqlite/sqljs`、摘要为中文，且摘要含解码边界一行（≤ 16 字节的非合法 UTF-8 → 可能落到 U+0000 → 以 -1 长度绑回时截断为空值，`TEXTDECODER=2` 存 U+FFFD）；正文只有这两行面向用户的内容，不含 spec 标注（`D4` / `D6` / `A7` / `A6` / `D5`）与内部核验命令，因为它会逐字成为 `packages/sqljs/CHANGELOG.md` 与 GitHub release 正文。
- PR 正文要素清单已在提交信息正文固化（`git log -1 --format=%B` 可核验）：六项条目名——五项 spec 条目标注（`D4` / `D6` / `A7` / `A6` / `D5`）及其实际值——体积实测值、与 changeset 摘要同一措辞的解码边界一行、「真机 iOS 回归待确认」标注、issue #23 病根更正评论的 permalink 及 D5 标题文本——加一项无 spec 条目的 `turbo.json` 环境回填（`"agentGuidance": false`，提交 `3288a76`），且不把 A6 标为通过；changeset 正文不承载该清单；PR 由 close 阶段按该清单组装，本计划不含创建 PR 的步骤。
- D5 的发布后义务有 owning 登记：提交信息正文含「发布后回 issue #23 补点名 `@weapp-sqlite/sqljs` 版本号的版本说明、issue 保持 open 直至 A6」这条待办与核验命令 `gh api repos/weapp-sqlite/weapp-sqlite/issues/23/comments --jq '.[].body'`，且本任务未因此新增只能在发布后完成的步骤；changeset 正文不追加该待办条目。
- A7 有 owning 步骤与证据：issue #23 的标题与评论经 `gh issue view 23 --repo weapp-sqlite/weapp-sqlite --json title,comments` 确认，提交信息正文引用同一 permalink 与 D5 标题文本（changeset 正文如需提及 issue #23，只用普通发布说明措辞并附同一 permalink，不带标注），使未安装 gh 的读者也能离线复核。
- A7 与 step 3 的 blocked 分支一致：该 `gh` 命令未确认成功即本任务以 blocked 结束，不把不可达的确认写成验收通过；A7 未获证据时清单内不标记为通过。

#### DependsOn

2

### Task 4: 把 vendor 断言（`verify:engines` 与 `verify:lite`）接入根门禁

#### Objective

让「已提交产物的断言」进入仓库门禁，而不只在重建路径与一次性本地跑上生效——这是 spec D3 的调用条件：`verify:engines` 与 `verify:lite` 都必须对**已提交的** vendor 产物在持续门禁上运行。只接入 `verify:engines` 会漏掉 `verify-lite.mjs` 承担的 manifest 完整性 + 体积预算这一面，而那正是「手工替换产物却不重算 manifest」在产物目录上留下的第二道痕迹。现状：`verify-engines.mjs` 的唯一自动化调用点是 `rebuild-engines.sh`（位于 manifest → engines → lite 序列中间），即它本该"越过"的那次构建，因此手工替换 vendor 产物这一被明确要防的场景从不被检查；`verify:lite` 今天只出现在重建路径和一次性本地跑里，同样不在门禁上。

另有一条同族的跨平台前置：`.gitattributes` 只用 `* text=auto` 约束 `packages/sqljs/docker/*.patch`（`git check-attr text eol` 对两片 patch 报 `text: auto` / `eol: unspecified`），而 `manifest.json` 的 `patches` 段记的是 LF 字节的 sha256——`core.autocrlf=true` 的检出会把 patch 转成 CRLF，`verify-lite.mjs:18` 于是在完好已提交产物上抛 `sqljs-reliability.patch does not match manifest.json.` 并 exit 1。实测：无该 pin 时两片 patch 为 5082 B / 4530 B（`w/crlf`），与 manifest 的 `4949` B / `4409` B 不符；加 `*.patch text eol=lf` 后同一探针仍得 LF 字节、`shasum -a 256` 与 manifest 逐位一致。故本任务先钉行尾、再接线，并把「矩阵各腿为绿」纳入判据。行尾 pin 还必须在克隆复验之前进入 HEAD：`git clone` 只取 HEAD，工作树里未提交的 pin 在克隆内不可见，克隆内得到的会是负向结果，故本任务把这唯一一次提交前移到复验之前，其余步骤对已提交内容只做读取与可还原探针（step 6 破坏、step 7 还原），不产生新的落定提交。

#### Files

- `package.json`（根，`scripts.validate` 链路或其下新增的聚合脚本）
- `packages/sqljs/package.json`（`scripts.verify:engines` 与 `scripts.verify:lite` 均已存在，本任务只消费）
- `.gitattributes`（在 `* text=auto` 之后新增 `*.patch text eol=lf`；该落点已在 spec 的「改动面」清单内——spec v0.10 由 orchestrator 按写入权回写并提交 `798f925`，归属本任务，故它是清单内改动而非清单外的新落点，本计划只引述该已成立事实）
- `.github/workflows/ci.yml`（仅当根 `validate` 未被 CI 调用时才需要）

#### Consumes

- `packages/sqljs/scripts/verify-engines.mjs`（Task 1 交付，断言结构：构造点紧跟 `globalThis.TextDecoder` 守卫，`&&` 与三元两种形态均通过）
- `packages/sqljs/scripts/verify-lite.mjs`（manifest 完整性 + lite 体积预算；读取 `dist/vendor/sql-wasm-lite.js` 作 `publishedCombinedBytes`，因此该步必须排在 `build` 之后）
- 根 `scripts.validate` 现有链路：`build → check:publish → lint → typecheck → tsd → test → test:release`
- `packages/sqljs/src/vendor/manifest.json` 的 `patches` 段（`sqljs-reliability.patch` 4949 B / `28ffe3ff…`，`sqljs-lite.patch` 4409 B / `ff01ef73…`，均为 LF 字节的摘要）
- `.gitattributes:17` 的 `* text=auto`（已入库三片 `*.patch` 均无 `eol` 规则，检出时按 autocrlf 决定行尾）

#### Produces

- 根门禁在已提交的 `packages/sqljs/src/vendor/*` 上执行两条 vendor 断言：`verify:engines`（守卫结构）与 `verify:lite`（manifest 完整性 + 体积预算）
- 一次人为破坏会转红的可复现证据
- `*.patch` 被钉为 `text eol=lf`：`core.autocrlf=true` 的检出重写后仍得 LF 字节，`shasum -a 256` 与 `manifest.json` 的 `patches` 段一致，门禁不再在 Windows 检出与 `windows-latest` 腿上对完好产物假红

#### Steps

- 钉 patch 面行尾：在 `.gitattributes` 的 `* text=auto` 之后新增一行 `*.patch text eol=lf`（已入库三片 `*.patch` 当前均为 LF、无 CR 字节，故该行不改变索引内容，只是一条检出规则） — checkable: `git check-attr text eol -- $(git ls-files '*.patch')` 对三片均报 `text: set` 与 `eol: lf`，且 `git status --porcelain` 只出现 `.gitattributes` 一处、没有 patch 文件被重新规范化
- 在根 `scripts.validate` 链路中挂入 spec D3 写法的那一步 `pnpm --filter @weapp-sqlite/sqljs verify:engines && pnpm --filter @weapp-sqlite/sqljs verify:lite`（放 `build` 之后，使两条断言检查的都是构建可用状态下的已提交产物） — checkable: `grep -n "verify:engines" package.json` 与 `grep -n "verify:lite" package.json` 均命中，且根 `validate` 链上出现运行这两条命令的一步（写成聚合脚本时，`validate` 链引用该脚本而脚本内含上述 `&&` 串联）
- 若 CI 未调用根 `validate`，在 `.github/workflows/ci.yml` 增补该步骤 — checkable: 该文件中出现一条运行 vendor 断言命令的步骤（按 D3 为 `verify:engines` 与 `verify:lite`），且该步骤排在 `Build` 步骤之后——`verify-lite.mjs` 的 `publishedCombinedBytes` 读 `dist/vendor/sql-wasm-lite.js` 并以 `.catch(() => undefined)` 兜底，在 build 之前运行会静默跳过体积预算那一面且仍 exit 0；同时贴一次 CI 同款命令的真实输出，确认含 `publishedCombinedBytes` 字段（字段缺失即该面未被验证）；该步骤在矩阵各腿上须为绿，证据二选一——CI 三平台实跑结论（`windows-latest` 腿正是行尾假红的判据），或 step 5 的模拟 CRLF 检出复验（分支未推送前默认取此项，推送后以 `windows-latest` 腿的 run 结论补证）——只验「步骤存在且位置正确」验不出行尾假红；若已调用则本步记 none 并说明。**不要在该 job 内整跑 `pnpm run validate`**：Build and Test job（`.github/workflows/ci.yml`）已逐步执行 lint / build / check:publish / typecheck / tsd / test / test:release，即根 `validate` 的 7 条成员，而该 job 带 `timeout-minutes: 15`，再跑整链时长近似翻倍、红的是 timeout 而不是守卫
- 提交（`chore(ci): 将产物守卫断言接入根门禁`）——这是本任务的唯一一次提交，也是下一步克隆复验的前提 — checkable: `git log -1 --format=%s` 输出上述提交信息，`git show --name-only --format='' HEAD` 含 `.gitattributes` 与 `package.json`（若上一步改过 CI 则另含 `.github/workflows/ci.yml`），且 `git status --porcelain` 为空
- 在提交后的 HEAD 上以模拟 CRLF 检出复验该 pin — checkable: `git clone --no-hardlinks . "$tmpdir"`（克隆取到的就是上一步的 HEAD，pin 已在其中）内 `git config core.autocrlf true`，先 `git check-attr text eol -- packages/sqljs/docker/*.patch` 报 `text: set` / `eol: lf`，再**强制重写**两片 patch（`rm packages/sqljs/docker/*.patch && git checkout -- packages/sqljs/docker/`；只跑 `git checkout -f` 会因 stat 缓存干净而跳过重写、给出假的 `w/lf`，本轮已实测这一陷阱），`git ls-files --eol packages/sqljs/docker` 报 `w/lf`，`wc -c` 为 `4949` / `4409`、`shasum -a 256` 与 `manifest.json` 的 `patches` 段逐条一致、`node packages/sqljs/scripts/verify-lite.mjs` exit 0（克隆内无 `dist`，体积预算一面按 `.catch(() => undefined)` 跳过，故此处证明的是 manifest 完整性）；负向对照：同一克隆内删掉该行后重跑同一命令，必须得到 `w/crlf`（`5082` / `4530` B）且 `verify-lite.mjs` 以 `sqljs-reliability.patch does not match manifest.json.` exit 1，两向都要留证。在未提交的工作树上复验**不构成证据**：工作树永远带着该行，结论与 pin 在 HEAD 上是否生效无关
- 人为破坏一处产物：把 `packages/sqljs/src/vendor/sql-wasm-lite.js` 中的守卫形态 `globalThis.TextDecoder&&` 改成 `true&&`，跑 `pnpm --filter @weapp-sqlite/sqljs verify:engines` — checkable: exit 1 且报 `sql-wasm-lite.js` 的 `text-decoder-guard-adjacent`
- 还破坏并复绿：`git checkout -- packages/sqljs/src/vendor/sql-wasm-lite.js` 后重跑 — checkable: exit 0，且 `git status --porcelain` 为空（证明还原彻底；提交已在 step 4 落定，破坏与还原不留痕迹，见 Acceptance）
- 挂入后实跑根门禁链路 — checkable: `pnpm run validate` exit 0（这一步给的是「挂入后的链确实被执行过」的证据；Task 3 step 2 的那次 `pnpm validate` 早于本次挂入，不能顶替），且跑完后 `git status --porcelain` 为空——整树干净是本次实跑后的判据，`AGENTS.md` 未被改写这一常规判据由它整体覆盖（自 `3288a76` 起 `turbo.json` 的 `agentGuidance: false` 已关闭该写回，v0.8 的 `git checkout -- AGENTS.md` 不再需要）

#### Acceptance

- 根门禁链路确实执行 `verify:engines` 与 `verify:lite`，且检查对象是已提交产物而非重建产物。
- `.gitattributes` 把 `*.patch` 钉为 `text eol=lf`：`git check-attr text eol` 对三片已入库 patch 均报 `eol: lf`，`core.autocrlf=true` 的模拟检出重写后仍是 LF 字节、`shasum -a 256` 与 `manifest.json` 的 `patches` 段一致——同一探针在没有该行时得 CRLF（`5082` / `4530` B）并使 `verify:lite` 在完好产物上以 `does not match manifest.json.` 失败，两向证据都留档。这项复验跑在 step 4 提交后的克隆内（clone 只取 HEAD）；在未提交的工作树上重跑同样命令不构成证据。
- 门禁在矩阵各腿上不因行尾假红：CI 步骤排在 `Build` 之后，其绿证据取 CI 三平台实跑或上述模拟 CRLF 复验，不把「步骤存在」当作「步骤通过」。
- 挂入后 `pnpm run validate` 实跑 exit 0：链路被执行过，而不只是两个脚本各自有效。
- 人为把守卫改成 `true&&` 时该门禁转红，还原后转绿；提交已前移到 step 4（克隆复验只能看到 HEAD），整树干净的判定在 step 8 实跑根门禁之后进行（`git status --porcelain` 为空）；`AGENTS.md` 不被改写是一常规判据——该副作用自 `3288a76` 起由 `turbo.json` 的 `agentGuidance: false` 关闭，无需任何丢弃动作。
- CI 侧只新增一条运行两条 vendor 断言的步骤，不新增整跑 `pnpm run validate` 的步骤（该 job 已含 `validate` 的 7 条成员与 15 分钟上限）。
- 不改变 `rebuild-engines.sh` 既有的 manifest → engines → lite 调用顺序。

#### DependsOn

3

## Change history

| Version | date       | summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | author                                                 |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| v0.1    | 2026-11-18 | 首版：三任务拆分（守卫断言先行以取得红证据 → 构建参数与重建 → changeset 收口），依赖链 1 → 2 → 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | pi (kairos:cdd-plan session)                           |
| v0.2    | 2026-11-18 | 评审修复：Task 3 增补 A7 owning 步骤（按 D5 确认并引用 issue #23 的标题与病根更正评论，PR 描述引用同一 permalink），Produces 与 Acceptance 补齐 A7；Task 2 step 2 判据由单处行号差改为与 lite patch 三条 Makefile hunk 的上下文行逐条无交集，并以 Docker 内 reliability → lite 真实二次应用为权威验证                                                                                                                                                                                                                                                                                                                                                             | pi (kairos:cdd-dev docs-fix round)                     |
| v0.3    | 2026-11-18 | 评审修复：Task 2 step 5 的 checkable 改为条件式——`verify:lite` 必须 exit 0，仅体积超阈的 exit 1 可进入 D4 裁决分支，其余 exit 1 一律判本步失败；F2（`pnpm validate` 前移）经裁决驳回，任务边界保持不变                                                                                                                                                                                                                                                                                                                                                                                                                                                            | pi (kairos:cdd-dev docs-fix round)                     |
| v0.4    | 2026-11-18 | 评审修复：Task 3 的 gh 命令显式钉 `--repo weapp-sqlite/weapp-sqlite`（origin 指向 issues 已关闭的镜像），Acceptance 与 step 3 的 blocked 分支对齐且 PR 描述同载 permalink 与 D5 标题文本以支撑离线复核；Task 2 step 2 判据由上下文行内容比对改为旧文件行区间位置判据（`31–63` 空档，与 `21–30` / `64–70` / `187–193` 不相交）；全文统一为 `-s TEXTDECODER=1`                                                                                                                                                                                                                                                                                                      | pi (kairos:cdd-dev docs-fix round)                     |
| v0.5    | 2026-11-18 | 追加 Task 4（DependsOn 3）：把 `verify:engines` 接入根门禁，落到 spec D3 的调用条件（F5 裁定）；其余任务内容与依赖链不变                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | pi (kairos:cdd-dev orchestrator, plan write authority) |
| v0.6    | 2026-11-18 | 评审修复：Task 4 的门禁步骤按 spec D3 的写法扩为 `verify:engines && verify:lite` 一步（排在 `build` 之后），Produces 与 Acceptance 改称「两条 vendor 断言」并补「挂入后实跑 `pnpm run validate`」的证据步；CI 侧写法收窄为只增一条运行 vendor 断言的步骤并禁止在 Build and Test job 内整跑 `pnpm run validate`（该 job 已有 validate 的 7 条成员与 15 分钟上限）；Task 3 的 changeset 摘要与 PR 描述各补解码边界一行（≤ 16 字节非合法 UTF-8 → U+0000 → 以 -1 长度绑回截断为空值，`TEXTDECODER=2` 存 U+FFFD），PR 描述另登记 D5 承接的发布后版本说明待办与 A7 的核验命令                                                                                           | pi (kairos:cdd-dev docs-fix round)                     |
| v0.7    | 2026-11-18 | 评审修复：Task 4 step 3 的 checkable 由 `git status --porcelain` 收窄为 `git status --porcelain packages/sqljs/src/vendor`（step 1 已改根 `package.json`，全树不可能为空，原判据永不成立），全树干净留给 step 6 提交之后；Constraints 第 19 行的「既有红基线」改为历史语态——失配已由 Task 2 重放消除（manifest 现记 `28ffe3ff…`，HEAD 上 `verify:lite` exit 0），与 spec 的 Constraints 与 A2 同口径；Task 4 step 5 的 checkable 补位置与字段要求（该 CI 步骤须排在 `Build` 之后，并贴一次真实输出确认含 `publishedCombinedBytes`，否则 `verify-lite.mjs` 的 dist 缺失分支会静默跳过体积预算仍 exit 0）                                                           | pi (kairos:cdd-dev docs-fix round)                     |
| v0.8    | 2026-11-18 | 评审修复：Task 4 step 4 的实跑步骤补 turbo 副作用口径——`pnpm run validate` 后若 turbo 在 `AGENTS.md` 写回 `<!-- BEGIN:turborepo-agent-rules -->` 托管块，按 Task 3 step 2 的同一口径丢弃、不带入 step 6 的提交，Acceptance 明确「整树干净」在 step 6 提交后判定（F1）；Task 3 的「PR 描述」载体改为本任务内可核验的 PR 正文要素清单——五项条目名与 spec 标注写入 changeset 正文、同五项实际值写入提交信息，逐条对应 spec D4 / D6 / A7 / A6 / D5，PR 由 close 阶段按该清单组装且本计划不含创建 PR 的步骤；Task 2 step 5 与 Acceptance 中同指 PR 描述的措辞改指该清单（F2）                                                                                          | pi (kairos:cdd-dev docs-fix round)                     |
| v0.9    | 2026-11-18 | 评审修复：changeset 正文不再承载 PR 正文要素清单——`pnpm change` 的正文就是 changelog entry，发布时逐字进入 `packages/sqljs/CHANGELOG.md` 与 GitHub release 正文，故只保留面向用户的中文摘要与解码边界一行，不含 `D4` / `D6` / `A7` / `A6` / `D5` 标注与 `gh api` 内部命令；五项清单（条目名 + spec 标注 + 实际值）改由 Task 3 的提交信息正文承载（`git log -1 --format=%B` 仍是任务内可核验载体），Objective / Produces / step 1 / step 4 / Acceptance 同步改判据（F1）；Task 1 step 1 与 Produces 的构造点描述补齐为 `new TextDecoder` 与 `new globalThis.TextDecoder` 两种拼写，与 spec D3/A1 及已入库的 `verify-engines.mjs:15` 同一匹配面，断言实现不变（F2） | pi (kairos:cdd-dev docs-fix round)                     |
| v0.10   | 2026-11-18 | 评审修复：`turbo.json` 的 `"agentGuidance": false`（提交 `3288a76`）取得文档归属——Task 3 Files 登记该回填、不清新开任务，PR 正文要素清单由五项扩为六项（新增无 spec 标注的 `turbo.json` 回填），Objective / Produces / step 4 / Acceptance 同步改判据，spec 的「改动面」同步补该落点并去掉「除此之外无预期改动」的绕对措辞（F1）；Task 3 step 2、Task 4 step 4 与 Task 4 Acceptance 中「turbo 写回托管块并丢弃」的陈述改为事实——自 `3288a76` 起 `agentGuidance: false` 已关该副作用，`git status --porcelain AGENTS.md` 降为常规判据、`git checkout -- AGENTS.md` 删除并留一行历史说明（F2）                                                                      | pi (kairos:cdd-dev docs-fix round)                     |
| v0.11   | 2026-11-18 | 评审修复：Task 3 step 4 的 checkable 末尾 `gh pr list` 负向确认改为显式钉 `--repo weapp-sqlite/weapp-sqlite`，并在该 checkable 写明失效面——镜像 `Oscaner/weapp-sqlite` 对 PR 列表不应答 404 而以 exit 0 返回空数组，不钉 `--repo` 时判据恒为 `[]`、与跟踪仓库是否已有该分支的 PR 无关（F1）                                                                                                                                                                                                                                                                                                                                                                       | pi (kairos:cdd-dev docs-fix round)                     |
| v0.12   | 2026-11-18 | 评审修复：`.gitattributes` 增 `*.patch text eol=lf`（Task 4 Files 登记，spec「改动面」清单之外的新落点按本轮裁决并入本任务、不新开任务），Task 4 前置两条步骤（钉行尾 + 模拟 CRLF 检出复验，含「`git checkout -f` 因 stat 缓存干净而跳过重写、须 `rm` 后 checkout」这一探针细节），CI 步骤判据补「矩阵各腿为绿」及其证据二选一，Objective / Consumes / Produces / Acceptance 与 Constraints 同步（F1）                                                                                                                                                                                                                                                            | pi (kairos:cdd-dev docs-fix round)                     |
| v0.13   | 2026-11-18 | 评审修复：Task 4 的唯一一次提交前移为克隆复验的前提（`git clone` 只取 HEAD、未提交的 pin 在克隆内不可见，原顺序会让 step 2 得到 `w/crlf` + `verify:lite` exit 1 的反向观察），Steps 重排为 pin → 门禁接线 → CI 补步 → 提交 → 克隆正负双向复验 → 破坏转红 → 还原转绿 → 实跑根门禁，克隆复验补 `git check-attr` 正向判据与负向对照、并写明未提交工作树不构成证据，Constraints 的「每个任务结束提交一次」改为「每个任务只提交一次、只读证据步骤可排在其后」（F1）；`.gitattributes` 改述为 spec「改动面」清单内落点（spec v0.10 / `798f925` 由 orchestrator 回写并归 Task 4），删除「本计划不改 spec」这一无承接表述（F2）                                           | pi (kairos:cdd-dev docs-fix round)                     |
| v0.14   | 2026-11-18 | 评审修复：Task 4 的排序规则句与自身步骤对齐——Constraints 的「只读证据步骤可以排在它之后」改为「只读证据与可还原探针可以排在它之后」，Objective 末句的「其余步骤都是只读证据」改为「其余步骤对已提交内容只做读取与可还原探针（step 6 破坏、step 7 还原），不产生新的落定提交」，两处同改以免同义规则分叉（F1）                                                                                                                                                                                                                                                                                                                                                     | pi (kairos:cdd-dev docs-fix round)                     |

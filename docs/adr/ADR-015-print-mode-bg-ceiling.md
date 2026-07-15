# ADR-015 · claude print-mode 后台任务等待上限默认注入 0（无限等待）

**Status: Accepted (2026-07-15)** · PRD-0015 S5（+ 修正包）· 影响 `src/server/chat-backends/claude.ts`（buildSpawn）、`src/infra/config.ts`（`chat.bgWaitCeilingMs` + `normalizeBgWaitCeilingMs`）、`src/ws-bridge.ts`（`ensureBgWaitCeiling` lazy-load 穿线）

## 背景

Studio chat 每轮 spawn 一个一次性 `claude -p --output-format stream-json` 子进程（ADR-005/ADR-013）。claude CLI 的 print-mode 自带"后台任务等待上限"环境变量 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`：满上限后 CLI **在子进程内部强制终止全部后台任务**（事故签名 `Background tasks still running after Ns; terminating.`），随即吐 `result` 帧并 code:0 正常退出。

**该变量与其默认值在 AutoViral 源码中零出现——纯上游行为。** 事故版本 **Claude Code 2.1.210** 二进制内默认 **600000ms（600s）**，正是 issue #96 / 030（`docs/issues/030-studio-chat-kills-background-workflow.md`）里"turn 结束 ~10 分钟后台 Workflow 全灭、两次复现同签名、用户无感知"的直接死因。

## 决策

claude 后端 `buildSpawn` **显式注入** `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`，不再继承上游二进制默认的 600000ms。**默认值 = `0`（无限等待）**；服务端配置 `config.yaml` 的 `chat.bgWaitCeilingMs` 可覆盖（运维想要止损上限时）。

- 默认常量：`DEFAULT_PRINT_BG_WAIT_CEILING_MS = 0`（`claude.ts`）。
- 配置项：`Config.chat?.bgWaitCeilingMs?`（`config.ts`，可选嵌套，随 jimeng/memory 先例）。**校验**：`normalizeBgWaitCeilingMs` 只接受非负安全整数；负数/小数/字符串/NaN 一律回落默认（记 `bg_wait_ceiling_invalid` 日志），绝不把脏值 `String()` 塞进 env。
- 穿线：`WsBridge` **lazy-load**（不放构造器——构造器不能有异步副作用，否则 `loadConfig` 的 config.yaml 写入会 race 测试 teardown 删临时目录）。`ensureBgWaitCeiling()` 在每个异步 spawn 入口（createSession / sendCommand / sendMessage）spawn 前 `await`：并发首批 spawn **共享同一个加载 Promise**（都 await 到真正加载完），`loaded` 标记只在 await 成功后置位（消灭"第二个并发调用短路带 undefined 去 spawn"的竞态），加载失败清空 Promise 允许下次重试。未读到/未配置/非法时 `bgWaitCeilingMs` 保持 `undefined` → 后端回落默认 0。

## 实证依据（九次受控实验，claude 2.1.210，macOS Apple Silicon，node v22）

原始秒级时间戳 JSONL 见 `src/server/chat-backends/__fixtures__/claude-tasks/`（脱敏入库）+ `scripts/probes/recapture-ceiling.sh`（可重跑）。**两类任务行为截然不同**——这是"默认 0"决策的关键，早前初稿把两者混为一谈（把只对 bash 型成立的"result 不被 hold"误当作普适结论，且声称测过 ceiling=0 实际没测；本节据九次实验修正）：

### local_workflow 型（Workflow 工具）—— ceiling **有效**，是本 ADR 真正的治理对象

- **result 帧被 hold**：最终 `result` 帧被 hold 到任务落定 + re-invoke 轮结束（exp7：回复文本 36s 就流出、`result` 90s 才出、单帧 `num_turns=2`）。
- **有限 ceiling 会强杀**：`env=15000` → 文本流出后整 15s 杀（exp8，`task_updated{killed}` + `task_notification{stopped}`，同 030 签名）。
- **`0` = 真·无限等待**：exp9（`env=0`）内层任务 30s 自然完成、85s 才吐 `result`、**无 ceiling 强杀签名**。这是**实测**过的，不是推断。
- **未覆盖（unset）** 继承上游默认 600000ms → 600s 到点强杀，即 030。

结论：workflow 型任务里，`0` 是**唯一**不重演 030 的值；因 workflow 的 `result` 本就被 hold 到任务收尾，chat turn 的**首个文本回复**并不因此延迟（文本帧照常即时流出），交互无回归代价。

### local_bash 型（`run_in_background` Bash）—— ceiling **完全无效**

- `result` **不被 hold**；最终 `result` 后 **~5s 一律收割**（`task_updated{killed}` + `task_notification{stopped}`）。
- env 完全无效：`0 / 5000 / 120000 / unset` 四组对照同款 ~5s（exp2/4/5/6）。exp1 那次只是任务恰好在窗口内 `completed` 触发 re-invoke 出第二个 `result` 帧——不是 env 生效。

即：**注入 `0` 救不了 local_bash 型后台任务，它们无论如何都在 turn 收尾后 ~5s 被上游收割**（见下"诚实边界"）。

### 嵌套上卷

workflow 内 subagent 的 bash 任务会出现在**外层进程**的 `background_tasks_changed` 清单里（exp7 的 `bj4kugy5f`），随外层进程命运——外层 workflow 走完/被杀，嵌套 bash 一并终结。

## 诚实边界（本止血救得了什么、救不了什么）

- **local_bash 型任务上游必杀 ~5s，本 ADR 救不了**：注入 ceiling=0 只对 workflow 型延命；`run_in_background` 的裸 Bash 任务在 turn 收尾后 ~5s 仍被上游收割，无可覆盖开关。对策分两层：(1) **S2 registry 如实上报终态**（收到 `killed/stopped` 就把任务标终态、广播给前端，不假装还在跑）；(2) **skills/autoviral recipe 层后续要教 agent**：需要活过 turn 的长任务用 **Workflow 工具**（受 ceiling 保护）而非裸 `run_in_background` Bash。
- **result-hold 的 UX 后果**：workflow 型 turn 的**文本即时流出**，但 `turn_complete`（`result` 帧）延迟到 workflow 完成——期间 chat 处于"文本已到、turn 未闭"的中间态。补位由 **S4 任务卡片**（把在跑的后台任务可视化，用户知道"还在等 workflow"而非卡死）+ **S6 门控 `sendMessage` 的 SIGTERM**（turn 未闭时的新消息不会盲杀在跑的 workflow）承接。
- **缓存语义 = lazy-load + restart-only**：`bgWaitCeilingMs` 首个 spawn 前 lazy-load 一次并缓存整个进程生命周期；改 `config.yaml` 后**必须重启 daemon** 才生效（与 dist server 进程"启动即冻结"的既有约定一致）。这是刻意的——config 极少改，不值得每 spawn 重读。

## 后果

- **止血生效**：默认 0 后，claude CLI 不再在子进程内替我们杀 **workflow 型**后台任务；宿主进程能活到 workflow 收尾。
- **杀前收尾归 S6**：本 ADR 只放开上游这把"计时器凶器"。放开 ceiling 后，AutoViral 侧不做收尾的进程回收点会接棒成为新凶手——**AutoViral 侧的 kill 点治理（按 cause 分级：可延迟的入队、可拒绝的 409、破坏性的立即 settle+广播终态）由 PRD-0015 S6 `KillGate` 负责**，与本止血是同一交付单元（只做其一都不完整，见 PRD Further Notes）。**注意"drain"在此是"立即收尾并如实广播终态"（settleOnExit + `ui-workflow` stopped），不是"等待后台任务跑完再退"**——`daemon_shutdown` 走 `shutdownAll` 遍历所有会话，逐一**立即**合成终态 + SIGTERM，绝不阻塞等待 workflow 完成；死代际就此关闭，退出进程冲刷出的迟到帧一律拒绝（不重开已 settle 的任务）。
- **上游漂移探测靠重采脚本，CI 无 claude 凭据无法自动红**：`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`、600s 默认、任务类 system 帧全是 claude 2.1.210 的外部行为。fixture（exp1/2/3/7/8/9 脱敏帧）入库 `__fixtures__/claude-tasks/`，`parser-contract.regression.test.ts` 钉住帧形状与终态词汇（`killed`/`stopped`/`completed`）——但它只是 **parser 契约回归**（给定已采集帧，parser 期望形状仍成立），**不能**自动探测上游改口。上游漂移的唯一发现手段是升级 claude CLI 后手动跑 `scripts/probes/recapture-ceiling.sh`、diff 新旧帧，形状变了再脱敏更新 fixture + parser + 回归测试。
- **运维可止损**：`config.yaml` 设 `chat: { bgWaitCeilingMs: 600000 }` 即恢复一个有限上限（重启 daemon 生效）；此时 workflow 型任务仍会在上限到点被杀，但 S6 落地后会带 settleOnExit + 终态广播，不再静默。

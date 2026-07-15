# ADR-015 · claude print-mode 后台任务等待上限默认注入 0（无限等待）

**Status: Accepted (2026-07-15)** · PRD-0015 S5 · 影响 `src/server/chat-backends/claude.ts`（buildSpawn）、`src/infra/config.ts`（`chat.bgWaitCeilingMs`）、`src/ws-bridge.ts`（配置穿线）

## 背景

Studio chat 每轮 spawn 一个一次性 `claude -p --output-format stream-json` 子进程（ADR-005/ADR-013）。claude CLI 的 print-mode 自带"后台任务等待上限"环境变量 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`：turn 的 `result` 帧会被 hold 等后台任务，等满上限后 CLI **在子进程内部强制终止全部后台任务**，随即吐 `result` 帧并 code:0 正常退出。

**该变量与其默认值在 AutoViral 源码中零出现——纯上游行为。** 事故版本 **Claude Code 2.1.210** 二进制内默认 **600000ms（600s）**，正是 issue #96 / 030（`docs/issues/030-studio-chat-kills-background-workflow.md`）里"turn 结束 ~10 分钟后台 Workflow 全灭、两次复现同签名、用户无感知"的直接死因。

## 决策

claude 后端 `buildSpawn` **显式注入** `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`，不再继承上游二进制默认的 600000ms。**默认值 = `0`（无限等待）**；服务端配置 `config.yaml` 的 `chat.bgWaitCeilingMs` 可覆盖（运维想要止损上限时）。

- 默认常量：`DEFAULT_PRINT_BG_WAIT_CEILING_MS = 0`（`claude.ts`）。
- 配置项：`Config.chat?.bgWaitCeilingMs?`（`config.ts`，可选嵌套，随 jimeng/memory 先例）。
- 穿线：`WsBridge` 构造时读一次配置缓存，`spawnCli` → `buildSpawn({ bgWaitCeilingMs })`；未读到/未配置时 `undefined` → 后端回落默认 0。

## 实证依据

本机复现实验（`claude --version` = **2.1.210 (Claude Code)**，macOS Apple Silicon，node v22）：

- **exp1（无 ceiling 覆盖，后台 Bash `sleep 8`）**：print-mode 下 `result` 帧**先出**、进程继续存活等后台任务；任务完成会 **re-invoke agent** 并吐第二个 `result` 帧后才退出（两个 `result/success`，`num_turns=2`）。即：**抬高/放开 ceiling 不会阻塞 chat turn 的首个回复**——`result` 不被 hold 到任务收尾，chat UX 无损。
- **exp2（`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=5000`，后台 `sleep 30` > ceiling）**：30s 任务在 5s 上限后被杀——`task_updated` 帧 `patch.status="killed"` + `task_notification` 帧 `status="stopped"`，进程随后退出且**不再 re-invoke**。证明：**任何有限 ceiling 都会在上限到点时强杀后台任务并静默收尾**——正是 030 的机理，只是把 600s 换成任意有限值同样重演。exp2 的终态帧已脱敏存为回归 fixture（见"后果"）。

结论：`0` 是唯一不重演 030 的默认值，且因 `result` 不被 hold，chat 交互与 kill 路径均无回归代价。

## 后果

- **止血生效**：默认 0 后，claude CLI 不再在子进程内替我们杀后台任务；宿主进程能活到后台任务收尾。
- **杀前 drain 归 S6**：本 ADR 只放开上游这把"计时器凶器"。放开 ceiling 后，AutoViral 侧 11 处无 drain 的进程回收点会接棒成为新凶手——**AutoViral 侧的 kill 点治理（杀前问一句、按 cause 分级 drain/广播终态）由 PRD-0015 S6 `KillGate` 负责**，与本止血是同一交付单元（只做其一都不完整，见 PRD Further Notes）。
- **上游漂移由 CI 承担**：`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`、600s 默认、任务类 system 帧全是 claude 2.1.210 的外部行为。exp2 的终态帧脱敏副本入库 `src/server/chat-backends/__fixtures__/claude-tasks/exp2-ceiling-terminal.jsonl`，探针 `ceiling-signature.probe.test.ts` 钉住终态词汇（`killed`/`stopped`）与帧形状——上游升级改口时 CI 先红，逼在产线复发前修 parser。
- **运维可止损**：`config.yaml` 设 `chat: { bgWaitCeilingMs: 600000 }` 即恢复一个有限上限（重启 daemon 生效）；此时后台任务仍会在上限到点被杀，但 S6 落地后会带 settleOnExit + 终态广播，不再静默。

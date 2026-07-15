# claude print-mode 后台任务终态帧实测锚定 fixture

PRD-0015 **S5**（+ 修正包）。本目录的 JSONL 是**本机真跑** `claude -p --output-format stream-json` 采集的原样任务生命周期 system 帧（脱敏后），作为 S1 seam 归一化（`normalizeBackgroundTaskFrame`）的契约来源与 parser 回归锁。**改 parser / 任务可见性链路前先读这里，别猜 schema。**

## 采集环境

| 项 | 值 |
|---|---|
| claude 版本 | `2.1.210 (Claude Code)`（`claude --version`）——与 030 事故同版本 |
| 平台 | macOS (darwin 25.4.0), Apple Silicon |
| node | v22 |
| 采集日期 | 2026-07-15 |
| 采集方式 | print-mode `-p --output-format stream-json --verbose`，逐行打相对秒时间戳 |

## 九次受控实验真值表（result-hold / 收割 / ceiling 行为）

**两类任务，行为截然不同——这是 ADR-015 的实证核心：**

| 任务类型 | env `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` | 观测行为 | 采集 |
|---|---|---|---|
| **local_bash**（`run_in_background` Bash） | 无效（0 / 5000 / 120000 / unset 四组对照同款） | `result` **不被 hold**；最终 `result` 后 **~5s 一律收割**（`task_updated{status:killed}` + `task_notification{status:stopped}`） | exp2/4/5/6 |
| **local_workflow**（Workflow 工具） | **有效** | 最终 `result` 帧被 **hold** 到任务落定 + re-invoke 轮结束（单帧 `num_turns=2`） | exp7/8/9 |
| local_workflow | `=0` | **真·无限等待**：内层任务自然完成后才吐 `result`，无 ceiling 强杀签名 | exp9 |
| local_workflow | 有限值（如 15000） | 文本流出后整 15s 强杀（"Background tasks still running after Ns; terminating."） | exp8 |
| local_workflow | unset（上游默认 600000） | 600s 到点强杀——**030 事故直接死因** | — |

补充事实：
- **`result` 帧数量 1..N**：local_bash 完成触发 re-invoke 时同进程出多个 `result` 帧（exp1 两帧）；local_workflow 被 hold 时只有最后一帧。
- **嵌套上卷**：workflow 内 subagent 的 bash 任务会出现在**外层进程**的 `background_tasks_changed` 清单里（exp7 的 `bj4kugy5f`），随外层进程命运。
- **`background_tasks_changed.tasks[]` 是权威全量快照**（`[]` = 已 drain）。
- **exp8 的一次性对照**：exp1 的 bash 任务只是恰好在窗口内 `completed` 并触发 re-invoke 出第二个 `result` 帧，不是 env 生效——env 对 bash 型完全无效。

原始九次实验的秒级时间戳 JSONL 存放在采集用的 scratchpad（带 `[Ns]` 前缀），入库时前缀被剥离（时序信息保留在上表）。

## 采集命令（原样，可重跑）

固化于 **`scripts/probes/recapture-ceiling.sh`**（升 claude CLI 后跑一次做上游漂移探测）。核心命令：

local_bash + 小 ceiling 复现强杀（`sleep 30` > ceiling `5000ms`）：

```sh
CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=5000 claude -p \
  '用 Bash 工具以 run_in_background:true 运行命令 `sleep 30 && echo neverseen`，然后立刻回复"started"结束本轮。不要等待任务。' \
  --output-format stream-json --verbose --dangerously-skip-permissions
```

local_bash 正常完成（`exp1-bgbash-terminal.jsonl`，`sleep 8`）：

```sh
claude -p \
  '用 Bash 工具以 run_in_background:true 运行命令 `sleep 8 && echo bgdone`，然后立刻回复"started"结束本轮。不要等待任务。' \
  --output-format stream-json --verbose --dangerously-skip-permissions
```

local_workflow 慢 agent（内层前台 `sleep 30`，暴露 result-hold + 嵌套 bash 上卷；`exp7/8/9`）：

```sh
# exp7 无 env（result hold ~90s）/ exp8 ceiling=15000（15s 强杀）/ exp9 ceiling=0（无限等待，自然完成）
CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude -p \
  '调用 Workflow 工具，script 参数用这段（原样，不要改动）：
export const meta={name:"slow-probe",description:"slow agent probe",phases:[]}
const r = await agent("用 Bash 工具运行 `sleep 30 && echo inner-done`（前台运行，等它完成），然后把文本 done-waiting 作为你的最终回复返回。")
return r
然后立刻回复"launched"结束本轮，不要等待 workflow。' \
  --output-format stream-json --verbose --dangerously-skip-permissions
```

## 文件清单

| 文件 | 采集会话 | 内容 |
|---|---|---|
| `exp1-bgbash-terminal.jsonl` | local_bash `sleep 8`（正常完成） | 5 帧，`task_type="local_bash"`，终态 **completed**（`task_updated.patch.status`/`task_notification.status`）。锁"任务自然收尾"happy path。 |
| `exp2-ceiling-terminal.jsonl` | local_bash + `ceiling=5000` + `sleep 30`（上限强杀） | 5 帧：`background_tasks_changed`(起点)→`task_started`(带 `tool_use_id`)→`background_tasks_changed`(清空)→`task_updated`(**killed**)→`task_notification`(**stopped**)。 |
| `exp3-workflow-terminal.jsonl` | Workflow 工具跑 noop-probe（正常完成） | 5 帧，**`task_type="local_workflow"`**，`task_started` 另带 `workflow_name`/`prompt`，`task_notification` 另带 `usage`。锁 workflow 类型与用量字段。 |
| `exp7-workflow-slow-terminal.jsonl` | local_workflow 无 env + 内层 `sleep 30`（result hold ~90s，自然完成） | 9 帧：workflow 快照 + **嵌套 `local_bash` `task_started` 上卷**；嵌套 bash 被杀（**killed/stopped**）而 workflow **completed**（带 `usage`）。锁"嵌套上卷 + 无 env 时 workflow 走完"。 |
| `exp8-workflow-ceiling15k-terminal.jsonl` | local_workflow + `ceiling=15000` + 内层 `sleep 30`（15s 强杀） | 7 帧：workflow 被上限强杀（`task_updated` **killed** + `task_notification` **stopped**）。锁"有限 ceiling 对 workflow 型有效、强杀签名同 exp2"。 |
| `exp9-workflow-ceiling0-terminal.jsonl` | local_workflow + `ceiling=0` + 内层 `sleep 30`（无限等待，自然完成） | 9 帧：同 exp7 结构，workflow **completed**（带 `usage`），无 ceiling 强杀。锁"ceiling=0 = 真无限等待"。 |

非任务帧（init/assistant/user/result 等）未纳入这些 fixture——它们只服务于任务生命周期 seam 归一化与终态签名回归；assistant/result 帧的解析在 `../../claude.test.ts` 覆盖。result-hold 的**时序**证据不在静态 fixture 里（fixture 无法编码时间），而在上面的真值表 + `scripts/probes/recapture-ceiling.sh` 的秒级采集里。

## 脱敏

采集原始流含会话/机器标识，入库前逐字段清除：

- **去 `session_id`**（每帧的会话 UUID）。
- **去 `uuid`**（每帧的 event UUID）。
- **绝对路径**：`task_notification.output_file` 的机器绝对路径换成 `<SCRATCH>/tasks/<task_id>.output` 占位。
- **剥离行首 `[Ns]` 时间戳前缀**（时序信息移入本 README 真值表）。

保留 `task_id`（ephemeral 任务 id）与 `tool_use_id`（`toolu_…`，launch↔lifecycle 缝合键）——它们是 seam 归一化把终态挂回 tool_use chip 所必需的关联键，非敏感。

## 观察到的任务类 system 帧（`subtype`）

| `subtype` | 关键字段 | 说明 |
|---|---|---|
| `background_tasks_changed` | `tasks: [{ task_id, task_type, description }]` | 后台任务集合快照；全部收尾/被杀后 `tasks: []`。嵌套 subagent 的 bash 任务也在此上卷。 |
| `task_started` | `task_id, tool_use_id, description, task_type` | 任务起点；`tool_use_id` 关联启动它的 assistant `tool_use` block。 |
| `task_updated` | `task_id, patch: { status, end_time }` | 任务状态推进；上限强杀时 `patch.status="killed"`、自然完成时 `"completed"`，带 `end_time`。 |
| `task_notification` | `task_id, tool_use_id, status, output_file, summary, usage?` | 任务终态通知；上限强杀时 `status="stopped"`、自然完成时 `"completed"`；workflow 型另带 `usage`。 |

## 回归锁与上游漂移探测（诚实边界）

- **回归锁**：`../../__tests__/parser-contract.regression.test.ts` 对上述帧形状与**终态词汇**（`killed` / `stopped` / `completed`）断言。这是"给定这些已采集帧，parser 期望形状仍成立"的**契约回归**——只在有人重采 fixture 时才应变动。
- **上游漂移探测靠重采脚本**：本仓 CI **没有 claude 登录凭据**，跑不了真 `claude -p`，所以"上游把 `killed→terminated` / `task_updated→task_ended` 改口"这类漂移**无法自动红**。发现它的唯一手段是升级 claude CLI 后手动跑 `scripts/probes/recapture-ceiling.sh`、diff 新旧帧。形状变了就脱敏更新 fixture + parser + 回归测试——这就是"在产线复发被杀无提示前修 parser"的时点。
- codex `__fixtures__/codex/fixtures.test.ts` 是同类 fixture 质量门的先例。

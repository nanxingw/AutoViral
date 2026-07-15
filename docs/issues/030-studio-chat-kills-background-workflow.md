# 030 · Studio chat 内 Claude 后台 Workflow 随 agent 进程退出被杀 — 无 drain/keepalive，resume 也活不过下一轮

**Severity: HIGH（workflow 多 agent 编排在 Studio chat 里事实不可用） · triage: `ready-for-agent`（根因已证实，收编 [PRD-0015](../prd/0015-agent-background-task-lifecycle-and-visibility.md)） · 记录日期: 2026-07-15 · 根因确认: 2026-07-15**

> GitHub: https://github.com/nanxingw/AutoViral/issues/96（用户 2026-07-15 明确要求同步上 GitHub）
> Source: 用户报告（2026-07-15）——"现在使用 claude 用不了 workflow 模式"。
> 同一 session 内完整复现两次，证据齐全（见下）。姊妹 issue：[031](031-studio-no-subagent-visibility.md)（前端对后台 subagent 零可见性——被杀了用户也无感知）。

## 现象（2026-07-14 23:22 起，work `w_20260714_2317_f24` 复现两次）

Studio chat 里的 Claude agent 用 Workflow 工具启动后台多 subagent 编排（run `wf_296ee812-c04`：6 research + 12 verify + 1 synthesize）。预期：主 turn 结束后后台任务继续跑，完成时以 task-notification 回调 agent。实际：

| 次 | 时间线 | 结局 |
|---|---|---|
| 1 | 23:22 启动 → 23:32 journal 最后写入 | 下一 turn 收到 `status=stopped` 通知："may have been running when the previous Claude Code process exited"。6 路 research 完成 5 路，verify 12 个刚启动完成 1 个 |
| 2 | `resumeFromRunId` 续跑 | 同样死法。journal 终态 48 行（36 started / 12 results）：research 6/6 有结果，verify 1/12，synthesize 未启动 |

两次都是 **turn 结束后不久进程退出，后台任务随进程死亡**；不是 workflow 脚本错误（journal 里 agent 结果全部正常）。

## 证据

- journal：`~/.claude/projects/-Users-nanjiayan-Desktop-AutoViral-autoviral-dist/a75f4a6e-dccf-405a-8f7e-6941dc3943e9/subagents/workflows/wf_296ee812-c04/journal.jsonl`（36 started / 12 results，同目录 19 个 agent-*.jsonl transcript）
- 两次 task-notification 均为同一签名：`No completion record was found ... It may have been ... running when the previous Claude Code process exited`

## 根因（已证实 2026-07-15 · Workflow `wf_766f984e-a6c` 3 路 codex 调研 + 3 路对抗验证 + 主线亲验）

**真凶不是 AutoViral 主动 kill，是 claude CLI print-mode 自己的后台任务等待上限。** Chat 每轮 spawn 一次性 `claude -p --output-format stream-json` 进程（`src/server/chat-backends/claude.ts` buildSpawn，stdin ignore），print-mode 会 hold 住 `result` 帧等后台任务，等满 600s（`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`，Claude Code 2.1.210 二进制内默认 600000ms）后**在子进程内部强制终止全部后台任务**→吐 result→正常退出。运行时日志两次事故同签名（`~/.autoviral/logs/2026-07-15.jsonl:504/506/517/519`）：

```
cli_stderr "Background tasks still running after 600s; terminating.
            Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely."
→ 7ms 后 turn_complete → ~0.5s 后 cli_exit code:0 signal:null（非 SIGTERM/SIGKILL）
```

600s = 10 分钟，与本 issue 时间线（23:22→23:32）严丝合缝。该变量在 AutoViral 源码零出现——纯上游行为，日志 + 二进制字符串双重验证。

**resume 无效的原因**：`--resume` 只重放对话史进新进程；resumeFromRunId 在新进程重启 workflow 后同架构再撞同一 600s 上限（日志第二签名）；且 journal 显示已完成 agent 在 resume 后以新 agent ID 重跑（重复花费实锤）。

**共犯**：AutoViral 侧另有 11 处 kill 点（新消息 SIGTERM 残活进程 `ws-bridge.ts:1159`、killSession SIGTERM+5s SIGKILL `:1229/1231`、断连 60s grace `:1885`、TTL 清扫、backend/model 切换、daemon 退出 handler 等）**全部无 drain 检查**——拉高 ceiling 后它们立即接棒成新凶手，止血与 drain 纪律必须同交付。原假设 1（"AutoViral 回收进程杀任务"）对本次事故不成立，但作为共犯路径成立；假设 2（无 drain）完全成立。

## 影响

- `.claude/rules/e2e-testing.md` Hard rule 0 要求 E2E 必须经 Workflow 多纬 subagent 编排——该纪律在 Studio chat 环境里事实不可执行。
- 深度调研/多 agent 任务只能退化为主轮内同步执行（占住整轮，本次 workaround 即如此）。

## Workaround（本次实操验证有效）

从 journal.jsonl 收割已完成 agent 的缓存结果 → 主轮内用 `run_in_background:false` 同步 fan-out 补跑剩余 agent → 主 agent 落盘产物。缺点：占满一个 turn，进程死亡=前功尽弃风险仍在。

## Acceptance criteria

- [ ] 预设测试已先行落盘并证红（server 侧 session 生命周期单测：存在运行中后台任务时，回收路径走 drain/持久化分支而非直接 kill）
- [ ] chat agent 进程存在运行中后台任务时不被立即回收：keepalive 至任务 drain 完，或优雅终止并把任务持久化为可 resume 状态
- [ ] 任务被终止时向 chat 流广播用户可见事件（与 [031](031-studio-no-subagent-visibility.md) 配合）
- [ ] E2E（Workflow 多纬编排，主 agent 不亲自执行）：chat 内启动后台 workflow → 结束 turn → 下一 turn 收到完成通知且 journal 含全部 results

## Code-area hints

- `src/server` agent session / ws-bridge 生命周期（killSession、per-message spawn 路径）
- 历史参考：chat model-tier switcher 用过 killSession（alias 切换即杀 session）——同一机制可能就是凶手

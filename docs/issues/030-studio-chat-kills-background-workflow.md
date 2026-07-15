# 030 · Studio chat 内 Claude 后台 Workflow 随 agent 进程退出被杀 — 无 drain/keepalive，resume 也活不过下一轮

**Severity: HIGH（workflow 多 agent 编排在 Studio chat 里事实不可用） · triage: `needs-triage` · 记录日期: 2026-07-15**

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

## 根因假设（未证实，待 diagnose）

1. Studio 的 agent session 生命周期（ws-bridge / killSession / per-message respawn）在轮次之间回收 claude 进程，后台任务被连带杀死。
2. 回收前没有 drain：不等待、不迁移、不持久化 harness-tracked background tasks，也不通知任何人。

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

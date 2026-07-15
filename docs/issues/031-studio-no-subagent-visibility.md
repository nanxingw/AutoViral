# 031 · Studio 前端对 agent 后台 subagent/Workflow 零可见性 — 无状态、无进度、被杀无提示

**Severity: MEDIUM（用户对付费多 agent 任务零感知） · triage: `needs-triage` · 记录日期: 2026-07-15**

> Source: 用户报告（2026-07-15）——"前端也不能显示背后运行的 subagent"。
> 姊妹 issue：[030](030-studio-chat-kills-background-workflow.md)（后台 workflow 被进程回收杀死）——030 的问题因为本 issue 而对用户完全隐形。

## 现象

Claude agent 在 chat 里 fan-out 的 Workflow/subagent（实例：work `w_20260714_2317_f24` 的 run `wf_296ee812-c04`，共 19 个 subagent：6 research + 12 verify + 1 synthesize）在 Studio UI 完全不可见：

- 没有任务卡片/进度树（对照：Claude Code 终端里有 /workflows 进度视图，Studio 里什么都没有）
- 没有 running / stopped / done 状态
- 任务被杀（见 030）时无任何提示——用户以为 agent 还在干活，实际早已死透

用户唯一的信息源是 agent 的文字播报，播报之外的真实状态不可核查。

## 影响

- 多 agent 编排烧 API 钱、跑十几分钟，用户全程盲飞，无法感知/暂停/取消。
- 030 类故障（进程回收杀任务）对用户完全静默，直到 agent 下轮自己发现并坦白。

## 期望

Studio chat 侧渲染后台任务面板（最小可用版即可）：

- agent 启动后台 workflow/subagent 时出现任务卡片：任务名、阶段、子 agent 计数、running/stopped/done 状态
- 完成/被杀时状态翻转 + toast
- 事件源：对齐现有 `autoviral progress start|step|done` 信封，或在 `contracts/event-stream.md` 扩展 workflow/subagent 事件信封，由 server 侧广播（与 030 的终止广播共用）

## Acceptance criteria

- [ ] 预设测试已先行落盘并证红（web store/组件测试：收到 workflow 事件信封 → 渲染任务卡片；同 id 状态更新不重复渲染）
- [ ] agent 启动后台 workflow 时 Studio 出现任务卡片（名称 + 状态）
- [ ] 任务完成/被杀时卡片状态翻转并 toast
- [ ] E2E（Workflow 多纬编排，浏览器纬度截图 + DOM/textContent 二确任务卡片存在与状态文本）

## Code-area hints

- `web/` chat panel（任务卡片 UI + store）
- `src/server` 事件广播 + `skills/autoviral/contracts/event-stream.md`（新信封需同步文档）

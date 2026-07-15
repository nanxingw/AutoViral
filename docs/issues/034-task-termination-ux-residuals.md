# 034 · 后台任务终止 UX 三残留（/stop 脱轮 no-op · stopped toast 待复核 · locale 混用）

**Severity: LOW-MEDIUM · triage: `ready-for-agent` · 记录日期: 2026-07-15**

> Source: v0.2.1 E2E 收口（wf_4b8943fe-f89 /stop 微探针 + wf_e9e6bb86-b44 R3）。核心终止语义已证实（/stop 与 Stop 按钮 → 卡片翻 stopped + reason 可见，删 work 干净回收），本 issue 跟踪三条不阻塞发布的 UX 残留。

## 1 · /stop 对"脱离 turn 的后台任务"是 no-op（真语义缺口）

`/stop` 的实现语义 = "Stop the active agent turn"。当 workflow 的 spawn turn 已结束（观测到 harness 在某些形态下先吐 result）而任务仍在跑时，`/stop` 提示 "There is no active turn to stop."、任务继续跑——用户的显式停止入口此态下只剩删 work。修复方向：/stop 在无活跃 turn 但 registry 有活任务时改走 `killSession(cause=user_stop)`（settle + 广播链路已就位），或卡片加 per-task stop 控件（PRD-0016 Out of Scope 有意留过，可重议）。

## 2 · stopped 终态 toast 未被 E2E 捕获（待复核，非确证缺陷）

completed 终态 toast 已 E2E 证实恰一次（R1）；stopped 走同一 ui-workflow 终态通道 + 前端同一 upsert/toast 判据，但三次 /stop 探针均因截图时序（toast ~4s 自动消失）未捕获。复核方式：探针改用 MutationObserver 常驻监听 toast 容器而非定时截图。若确缺，查 settleOnExit 广播与 freshTerminal 判据在 stopped 路径的交互。

## 3 · 终态/排队提示 locale 混用（i18n 一致性）

排队提示 toast 服务端硬编码简体中文（"后台任务运行中，消息将在完成后发送。"），完成 toast 走前端 locale（英文 "Task finished · …"）——同一面板两种语言。修复：chat_notice 信封带 kind 由前端 i18n 渲染（服务端 message 只作 fallback），对齐 #73 的 i18n-as-data 教训。

## Acceptance criteria

- [ ] /stop 在"无活跃 turn + 有活任务"时终止任务（卡片翻 stopped + reason=user_stop）或产品决策明确替代入口
- [ ] stopped toast 经 MutationObserver 级探针证实恰一次（或修复）
- [ ] 排队/终态提示同一 locale 渲染（前端 i18n 键驱动）

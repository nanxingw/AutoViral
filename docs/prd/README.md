# PRD · 产品 / 治理需求文档

> PRD（Product Requirements Document）回答一个问题：**为谁、建什么、用什么验收标准判定建成了**。它是 issue 的上游——一份 PRD 切成若干可独立认领的 issue（经 `to-issues` skill），issue 才进入实现。PRD 不写「怎么实现」（那是 ADR / 实现计划的事），只写「要什么、不要什么、怎么算成」。

---

## 约定

- **位置**：所有 PRD 落在 `docs/prd/` 下，平铺，不再分子目录。
- **命名**：`NNNN-slug.md`，四位单调递增序号 + 短横线小写标题（如 `0001-v0.1.0-release-and-conventions.md`）。序号一旦分配不复用、不回填；新 PRD 取「当前最大序号 + 1」。
- **产出方式**：优先用 `to-prd` skill 从对话上下文生成草稿，再用 `to-issues` 切片发布到 GitHub Issues。issue tracker 的位置、label、发布规则见 [`../agents/issue-tracker.md`](../agents/issue-tracker.md) 与 [`../agents/index.md`](../agents/index.md)。
- **状态头**：每份 PRD 顶部带 `状态` + `日期`（PRD-0001 用「Proposed」；规范状态机见下）。状态变化时改头部并补一行日期，不要删旧状态历史。
  - `Draft` — 起草中，尚未定稿。
  - `Active` — 已定稿、已切 issue、正在实现。
  - `Shipped` — 验收标准全部满足、对应 release 已发出。
  - `Superseded` — 被更新的 PRD 取代（注明取代它的 PRD 编号）。
- **与 ADR 的边界**：PRD 写「为谁建什么 + 验收口径」（产品/治理视角）；ADR（[`../adr/`](../adr/)）写「为什么选这个架构 + 权衡了什么」（架构视角）。一份 PRD 里若出现需要锁定的架构选择，把它独立成 ADR 并在 PRD 里链过去——不要把架构论证塞进 PRD 正文。

---

## 一份 PRD 应包含的小节（可复用清单）

不是每份 PRD 都要塞满所有小节，但下面这些是默认骨架；缺哪个要想清楚是否真的不需要。

- [ ] **状态头** — 状态 + 日期 + 作者 + 类型（feature / governance）+ 影响分支。
- [ ] **Why / Problem Statement** — 为什么现在要做；不做的代价是什么。
- [ ] **目标用户（for whom）** — 谁会因此受益（用 user story 或角色描述具体化）。
- [ ] **In scope** — 这份 PRD 明确承诺交付的东西。
- [ ] **Out of scope / Non-Goals** — 明确**不**做的东西，挡住范围蔓延。
- [ ] **验收标准（acceptance criteria）** — 可观测、可验证的判定条件。**必须遵守 E2E 规则**：端到端通过的唯一标准是浏览器里看得到用户被许诺的结果，不是后端 artifact（详见 [`/.claude/rules/e2e-testing.md`](../../.claude/rules/e2e-testing.md)）。
- [ ] **领域不变量（domain invariants）** — 本需求触及 [`/CONTEXT.md`](../../CONTEXT.md) 里哪些不变量；保证不会被静默破坏。
- [ ] **Issue 切片（issue slices）** — 如何切成可独立认领的 tracer-bullet 垂直切片（喂给 `to-issues`）。
- [ ] **风险（risks）** — 已知风险、未决问题（Open Questions）、回退策略。

---

## 现有 PRD

| 编号 | 标题 | 状态 | 日期 |
|---|---|---|---|
| [0001](0001-v0.1.0-release-and-conventions.md) | v0.1.0 发布与工程约定（包改名 `autoviral@0.1.0` / docs 重组 / Electron 桌面壳 / CI+Release / 合 main 打 tag） | Proposed | 2026-06-02 |
| [0002](0002-v0.1.1-extensibility-foundation-and-cleanup.md) | v0.1.1 可扩展性奠基与结构清债（ContentTypeRegistry / 单一 MediaProvider / carousel skill+CLI / AGENT.md 双轨 / api.ts 拆分 / migrations 骨架） | Draft | 2026-06-03 |
| [0003](0003-v0.1.2-zero-friction-setup.md) | v0.1.2 一揽子（§1 外部依赖自举 · §2 TTS 网关一致性 Gemini-via-OpenRouter+edge · §3 素材库+时间线交互 对齐 pro 编辑器 · §4 agent 视觉自检 snapshot · §5 多对话/多终端会话 新建+保留+跳回〔需 ADR-008〕） | Active | 2026-06-04 |
| [0004](0004-v0.1.3-wire-the-nle-to-agents.md) | v0.1.3 把 NLE 接通到 Agent（M1 @shared 意图 ops 共享核心〔需 ADR-009〕 · M2-M3 patch+preflight · M4 写路径 broadcast · M5-M7 意图动词+CLI+错误码 · M8 ASR 字幕 · M9 preset 真生效 · M10 止谎 · M11 基础画面操作 crop/fit-fill/比例/翻转/倒放/定格 · M12 undo+checkpoint restore） | Draft | 2026-06-04 |
| [0005](0005-v0.1.5-bug-backlog-issue-slices.md) | v0.1.5 bug backlog（9 个对抗验证过的真 bug；docs-only tracker，非 PRD 而是 issue 切片直存） | Active | 2026-06-05 |
| [0006](0006-v0.1.5-inspiration-data-redesign.md) | v0.1.5 诚实的数据 + 有根的教练（灵感 & 数据两页重做：D1 接已有 per-work 数据 · D2 benchmark 带 · D3 洞察诚实护栏 · D4 托管 venv 重建抖音采集器 · D5 持久策略 coach · 删人口卡换诚实空态） | Shipped | 2026-06-08 |
| [0007](0007-v0.1.6-script-storyboard-planning.md) | v0.1.6 剧本 · 分镜规划层（唤醒潜伏 SceneSchema + plan/script.md：剧本=叙事总纲≈PRD · 分镜=逐镜执行表≈issue · 素材区第三 tab 可视可手改可让 agent 改 · 生成=下游 handoff · 计划/执行解耦 · 单层 Scene 不预埋电影级层级 · per-work 写锁加固） | Draft | 2026-06-08 |

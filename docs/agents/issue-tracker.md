# Issue tracker · AutoViral

**Type:** 本地 Markdown in `docs/` —— **不是 GitHub Issues**。
**硬规则（用户 2026-06-04）：issue 一律写在 `docs/` 里，绝不创建 GitHub Issue、绝不 `gh issue create`——不污染 GitHub 网页。**

## Issues 写在哪

- **Canonical（已提交、随 clone 分发）**：从 PRD 拆出的切片汇总在 **`docs/prd/NNNN-<slug>-issue-slices.md`**（一片一节，每片带完整 body：What / Acceptance criteria / Blocked by），与它的 PRD 一同提交。这是 issue 的事实源。
- **可选的逐片草稿**：`docs/issues/NNN-slug.md`（一文件一 issue，沿用既有 001–025 的编号习惯），用于不挂 PRD 的独立 bug，或偏好一文件一 issue 时。**注意**：`docs/issues/` 目前被 `.gitignore`（历史上是"待 gh 发布"的临时暂存）；若希望这些逐片文件也版本化共享，从 `.gitignore` 移除 `docs/issues/` 即可。

## Operations（全部 docs-only，零 gh）

| Skill | 做法 |
|---|---|
| `to-prd` | PRD 写进 `docs/prd/NNNN-*.md`。**不**开 GitHub epic issue。 |
| `to-issues` | 每个 tracer-bullet 切片落进 `docs/prd/NNNN-*-issue-slices.md`（canonical）或 `docs/issues/NNN-*.md`。**不** `gh issue create`。 |
| `triage` | triage 状态写在 issue 文件的标题/字段里（不是 GitHub label）。 |
| `diagnose` / `tdd` | 直接读 `docs/` 下的 issue 文件取上下文。 |

## Triage 状态词汇（仍沿用，写进文件而非 GitHub label）

`needs-triage` / `waiting-on-reporter` / `ready-for-agent` / `ready-for-human` / `wontfix`。详见 [triage-labels.md](triage-labels.md)。AFK 片标 `ready-for-agent`，含人决策的架构契约（HITL）标 `ready-for-human`。

## Issue body 约定

- **Parent**：若派生自 PRD/父 issue，body 首行 `> Parent: <PRD 路径或父片号>`。
- **Source**：来自 PRD 的标 `Source: docs/prd/<file>.md`。
- **Acceptance criteria**：可测的 checklist。**E2E 验收项必须经 Workflow 多纬度 subagent 执行**（见 [`/.claude/rules/e2e-testing.md`](../../.claude/rules/e2e-testing.md) Hard rule 0），主 agent 不自己点浏览器。
- **Code-area hints**：标出最深的目录，方便 AFK agent 直接定位。

## What goes where

- **PRD → `docs/prd/`**（canonical）。
- **Issue 切片 → `docs/prd/NNNN-*-issue-slices.md`**（canonical，已提交）/ 可选 `docs/issues/NNN-*.md`（本地）。
- **架构决策 → `docs/adr/`**（immutable）。

## 历史

此前本约定为 GitHub Issues（`gh` as `nanxingw`）。**2026-06-04 用户改为 docs-only**：issue 留在 docs，不上 GitHub。`docs/issues/` 不再是"待 gh 发布"的暂存区。

# UI Redesign · Master Plan Index

**Spec**: `docs/superpowers/specs/2026-04-25-ui-redesign-design.md`
**Mode**: R1 Big Bang — 5 个子 plan 在分支 `refactor/ui-v3-react` 上分别完成、各自冒烟通过；最后一起合并 `main`，单点 cutover。
**Subagent model**: Opus（CLAUDE.md 规则：所有 subagents 必须 Opus 驱动）。

## 子 Plan 与依赖

```
Plan 1 (scaffold + 三页) ─┬─→ Plan 2 (Studio)  ─┐
                          ├─→ Plan 3 (Editor)  ─┤
                          │                     ├─→ Plan 5 (cutover)
Plan 4 (后端 + skill) ────┘─────────────────────┘
```

| # | Plan 文件 | 状态 | 依赖 |
|---|---|---|---|
| 1 | `2026-04-25-ui-redesign-01-scaffold.md` | ✅ 已落地（tag plan1-scaffold-complete） | — |
| 2 | `2026-04-25-ui-redesign-02-video-studio.md` | ✅ 已写（25 tasks） | Plan 1 |
| 3 | `2026-04-25-ui-redesign-03-image-editor.md` | ✅ 已写（18 tasks） | Plan 1 |
| 4 | `2026-04-25-ui-redesign-04-backend-d3.md` | ✅ 已写（13 tasks，subagent 执行中） | — |
| 5 | `2026-04-25-ui-redesign-05-cutover.md` | ✅ 已写（8 tasks） | Plans 1-4 |

## 执行顺序（推荐）

1. **Plan 1** 完整跑完（前端能起、3 个非编辑器页面用真实 API、Studio/Editor shell 占位）
2. **Plan 4** 与 **Plan 1** 并行启动（后端 D3 改造，因为前端到 §F TanStack queries 时已经需要新的 `/api/works/{id}/invoke` endpoint 形态）
3. **Plan 2** + **Plan 3** 在 Plan 1 落地后并发跑（两个 Opus 子代理各负责一个，无 file 冲突）
4. **Plan 5** 最后做 cutover：CLAUDE.md brand 段覆盖、migration 脚本、e2e 4 条冒烟、合并主分支

## 全局硬约束（每个 plan 子代理都必须遵守）

1. **TDD**：每个行为变更步骤先写失败测试再实现
2. **每完成一个 task 就 commit**，commit message 用 conventional commits（`feat:`/`refactor:`/`test:` etc.）；commit 信息**禁止**包含"流水线/阶段"措辞
3. **Skill 文件改动前**：必须先 fetch 最新 https://github.com/obra/superpowers + https://github.com/garrytan/gstack 内容；这是 CLAUDE.md:32 强制规则
4. **不引入"阶段"概念**：UI/数据/API/prompt 任何位置都不写 `step` `stage` `phase` `pipeline` 等顺序词；模块作为能力词典存在
5. **Subagent 模型固定 Opus**

## 进入 Plan 1

下一步：subagent-driven-development 模式逐 task 执行 `2026-04-25-ui-redesign-01-scaffold.md`。

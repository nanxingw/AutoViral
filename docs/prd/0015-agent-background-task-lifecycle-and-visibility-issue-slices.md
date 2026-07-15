# PRD-0015 · Issue slices（docs-only tracker）

> Parent: [PRD-0015](0015-agent-background-task-lifecycle-and-visibility.md) · 全部 `ready-for-agent` · 2026-07-15 切片
> 纪律：每片 AC 第一项 = 预设测试先行落盘并证红（[test-first](../../.claude/rules/test-first.md)）；E2E 收口在两 PRD（0015/0016）实现完后统一派 Workflow 多纬 subagent（[e2e-testing](../../.claude/rules/e2e-testing.md)），纬度清单见 PRD Testing Decisions。
> Wave 计划：W1 = S1 ∥ S5 → W2 = S2 → W3 = S3 ∥ S6 → W4 = S4 ∥ S7。

---

## S1 · 任务帧 fixture 抓取 + ChatBackend seam 归一化（AFK）

**What to build**：在真实环境跑一个最小后台 Workflow 的 `claude -p --output-format stream-json` 会话，抓取完整 stdout NDJSON 存为脱敏 fixture（含 task lifecycle system 帧与 Workflow tool_use/tool_result 帧）；据 fixture 在 ChatBackend seam 新增归一化后台任务事件回调（started/progress/notification/terminal，保留 taskId、tool_use id 关联、描述、计数、usage），claude 后端翻译，codex 后端空实现。归一化事件先以日志形式可观测（下游 S2 接管）。

**预设测试**：`src/server/chat-backends/__tests__/claude.task-frames.test.ts` — fixture 流喂入 parser：① task 帧触发归一化回调且字段齐全；② 非 task 帧行为与现状逐字节一致（回归）；③ tool_use id 在回调里可关联 tool_result。

**Acceptance criteria**
- [ ] 预设测试先行落盘并证红
- [ ] 真实抓取的 fixture 入库（脱敏），来源命令与 CLI 版本注明
- [ ] fixture 全部 task 帧被归一化；未知帧仍走 onOther（不回归 cli_event 转发）
- [ ] codex 后端空实现不破既有测试

**Blocked by**: None - can start immediately

## S2 · BackgroundTaskRegistry + settleOnExit（AFK）

**What to build**：server 侧每 chat session × 进程代际的任务表深模块：`applyEvent`（同 id upsert + 状态机 running/done/failed/stopped/killed）、`snapshot`、`settleOnExit`（宿主进程退出时把仍 running 的任务合成终态 + reason）。ws-bridge 把 S1 归一化事件喂入 registry；进程 exit 路径调用 settleOnExit。纯逻辑、时钟注入、零 I/O。

**预设测试**：`src/server/sessions/__tests__/background-task-registry.test.ts` — ① 同 id 两次 applyEvent 只有一条且状态覆盖；② settleOnExit 把 running→stopped 并带 reason；③ snapshot 返回当前全量；④ 进程代际隔离（新进程的任务不吞旧代终态）。

**Acceptance criteria**
- [ ] 预设测试先行落盘并证红
- [ ] ws-bridge exit handler 接 settleOnExit（spawn-mock 会话测试断言）
- [ ] registry 不依赖 Date.now 裸调（时钟可注入）

**Blocked by**: S1

## S3 · ui-workflow 信封 + snapshot-on-connect + 契约文档（AFK）

**What to build**：bridge 新事件 `ui-workflow`（任务 upsert 与终态，身份 = sessionId+taskId），浏览器 WS 连接/重连时先发全量 snapshot 再增量（render 进度通道的既有 snapshot-then-push 模式）；`skills/autoviral/contracts/event-stream.md` 同步新信封（same-id replace 语义、状态机、进程退出行为）。不动 ui-progress。

**预设测试**：`src/server/__tests__/ui-workflow-envelope.test.ts` — ① registry 变更触发 ui-workflow 广播且 payload 合 schema；② 新连接先收到 snapshot；③ settleOnExit 触发终态广播。

**Acceptance criteria**
- [ ] 预设测试先行落盘并证红
- [ ] event-stream.md 新信封文档与实现一致（含字段表与语义）
- [ ] ui-progress 行为零变化（回归测试）

**Blocked by**: S2

## S4 · Web 任务卡片面板 + 终态 toast（AFK）

**What to build**：web 侧任务 store（Map keyed by sessionId+taskId，同 id 覆盖式 upsert）消费 ui-workflow；chat 面板渲染 durable 任务卡片（任务名/阶段/子 agent 计数/状态）；仅终态转换触发 toast；`session_killed`/`cli_exited` 联动卡片翻终态（不再只折叠 streaming 布尔）。刷新/重连经 snapshot 恢复。

**预设测试**：`web/src/features/chat/__tests__/workflow-tasks.store.test.ts` — ① 同 id 两次到达渲染一条、状态覆盖（031 AC 原文）；② 终态转换触发一次 toast、重复终态不重复 toast；③ snapshot 全量替换本地状态。组件测试：卡片文本含任务名与状态。

**Acceptance criteria**
- [ ] 预设测试先行落盘并证红
- [ ] agent 启动后台 workflow → Studio 出现任务卡片（E2E 收口纬度②截图+DOM 二确）
- [ ] 被杀/完成 → 卡片翻终态 + toast（E2E 收口纬度③）

**Blocked by**: S3

## S5 · spawn ceiling 配置 + 实测定默认值 + ADR（AFK）

**What to build**：claude 后端 spawn env 注入 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`（服务端配置可覆盖）；实测 ceiling=0 下 result 帧 hold 行为与对 chat 交互/kill 路径的连锁影响；据实测在"高值+drain 兜底"vs"0+语义调整"间定默认值，结论落 ADR（短文）；stderr 签名探针回归测试钉上游行为漂移。

**预设测试**：`src/server/chat-backends/__tests__/claude.spawn-env.test.ts` — ① buildSpawn env 含配置值；② 未配置时用 ADR 定的默认值；③ 显式 0 透传。契约回归：`src/server/chat-backends/__tests__/parser-contract.regression.test.ts` 对 fixture 化任务帧形状/终态词汇断言（parser 契约锁；上游漂移探测靠 `scripts/probes/recapture-ceiling.sh` 手动重采，CI 无 claude 凭据无法自动红）。修正包另加：`config-bg-ceiling.test.ts`（`normalizeBgWaitCeilingMs` 校验）+ `ws-bridge-bg-ceiling.test.ts`（lazy-load 竞态/重试）。

**Acceptance criteria**
- [ ] 预设测试先行落盘并证红
- [ ] 实测记录（ceiling=0 的 result 时序）+ ADR 落盘
- [ ] 默认值生效且可配置覆盖

**Blocked by**: None - can start immediately

## S6 · KillGate drain 纪律（AFK）

**What to build**：全部进程回收路径（新消息替换、killSession 各调用方、断连 grace、TTL 清扫、backend/model 切换、daemon 退出）收敛过单一 `requestKill(session, cause)` chokepoint：registry 报告有活任务时按 cause 分级——可等待 cause 走 drain/延迟，用户显式意图（/stop、删 work）走杀+settleOnExit+广播终态；绝不静默。

**预设测试**：`src/server/__tests__/kill-gate.test.ts`（spawn-mock 模式）— ① 有活任务 + 可等待 cause → 不 kill、进 drain；② 显式 cause → kill + settleOnExit + 广播断言；③ 无活任务 → 行为与现状一致（回归）；④ 11 处调用点全部走 gate（sweep matrix：枚举 cause 家族逐一断言，contract-test-sweep-gate 纪律）。

**Acceptance criteria**
- [ ] 预设测试先行落盘并证红
- [ ] 裸 `cliProcess.kill` 调用点归零（grep gate + lint/测试挡新增）
- [ ] E2E 收口纬度①：发新消息不再杀活任务

**Blocked by**: S2

## S7 · Journal 打捞 orphaned（AFK · P1）

**What to build**：宿主进程死亡且 registry 有未终态任务时，从对应 workflow journal 收割已完成 agent 的结果与进度，registry 标记 orphaned（终态广播带已完成计数与可 resume 线索）；只做可见性与止损，不自动重跑。

**预设测试**：`src/server/__tests__/journal-harvest.test.ts` — 用事故 journal 脱敏副本作 fixture：① 收割出正确的完成计数/结果摘要；② resume 产生的重复 key 去重（按 journal key 非行数）；③ journal 缺失/损坏 → 优雅降级为 stopped 无打捞。

**Acceptance criteria**
- [ ] 预设测试先行落盘并证红
- [ ] orphaned 终态在任务卡片可见（含已完成计数）
- [ ] 打捞失败不阻塞 settleOnExit 主路径

**Blocked by**: S2, S3

# ADR-010: Grounded coach — a second, persisted agent persona on 灵感

- **Status:** Accepted
- **Date:** 2026-06-08（随 v0.1.5 发布回填 — 决策在 PRD-0006 实现期定，发版后补记）
- **Deciders:** nanxingw（拍板"灵感页该有 chat 接口的 agent" + 持久对话）+ AI design partner（PRD-0006 调研 13-agent workflow）
- **Related:** [ADR-005](ADR-005-dual-chat-entry-layout.md)（Chat/Terminal 双入口；Chat = `claude -p` 子进程）· [ADR-008](ADR-008-multi-session-chat-terminal.md)（`(workId, sessionId)` 多会话 + sidecar 持久化）
- **Resolves:** [PRD-0006](../prd/0006-v0.1.5-inspiration-data-redesign.md) 切片 S6/S7/S8 + 用户问题"灵感页是不是也应该放一个有 chat 接口的 agent"

## Context

PRD-0006 调研（13-agent workflow + 主 agent 亲手验代码）坐实一个反差：

1. **第二个 agent persona 早已建好，却整个 dark。** `src/ws-bridge.ts:570` 的 `createTrendSession` 是一个**独立于 Studio 剪辑 agent** 的"趋势研究"persona，跑在同一套 `spawnCli` NDJSON→WS 传输上，会 WebSearch 并写 `data.json` / `report.md`。但 `web/src` 里 grep `refresh-stream` / `createTrendSession` / `research_*` 的调用方 = **零**；更糟，`web/src/features/chat/useChatSocket.ts:234` 明确"静默忽略 research_* 事件"。基建建好了在黑着。

2. **灵感页是纯只读浏览。** `Explore.tsx` 只调用同步的 `/api/trends/refresh`，从不碰流式 agent。最显眼的"起手切角灵感"卡是 3 条写死样例 + 禁用按钮。创作者不能问"这周我该做什么选题"。

3. **整套聊天 UI 是 persona-agnostic 的。** `ChatPanel`（`web/src/features/studio/panels/Chat/index.tsx`）+ `useChatSocket` + 聊天 store + ModelSwitcher + 附件上传 + in-band `<viewer-action>` —— 这套流式 markdown 聊天栈本身不绑定"剪辑"语义，只是**硬耦合到 `workId`**（history seed / 附件上传目标 / checkpoint 回滚 / viewer-context 都按 workId 取）。

4. **外部对标决定性**（PRD-0006 外研）：vidIQ 2026 的旗舰动作正是这个——一个扎根于创作者自身数据 + 实时趋势的 AI Coach 聊天页，吐打分过的选题。AutoViral 独有优势：它**已经是本地 agent**，9 件作品 + 趋势 artifact 就在同一台机器上，比 vidIQ 只读云 MCP 起点更高。

关键约束三条，夹出了下面的决策：
- ADR-008 的 sidecar 持久化是按 `(workId, sessionId)` 键控的；但 coach **没有 work**。
- `createTrendSession` 走的 `trends_` 会话路径**故意跳过 sidecar**（`sidecarFor` 对 `trends_*` 返回 null）→ 一次性、无历史。而用户要的是**持久**策略对话。
- ModelSwitcher 持久化的是**全局** `config.model`，respawn 按单个 workId 键控（`POST /api/agent/model`）；coach 若共享这个全局设置，会和剪辑 agent 抢档位。

## Decision

**在灵感页挂一个有根的"研究/策略 coach"——它是 Studio 剪辑 agent 之外的第二个 agent persona，复用现有聊天传输/UI，但作为一个 workless、sidecar 持久化、model 作用域独立的会话存在。**

### 本 ADR 锁定的决策

1. **复用聊天栈，新增 persona，不另起一套。** coach 复用 `ChatPanel` + `useChatSocket` + 聊天 store，不重写流式 UI。新增的只是：一个 `CoachConfig` prop 让 `ChatPanel` 进入"workless coach 模式"，和一个 `buildCoachSystemPrompt`（研究/策略 persona，**非** `buildSystemPrompt` 的剪辑/交付 persona）。

2. **workless 持久会话，单一稳定 key `coach_main`。** coach 不是一个 work。它有自己的稳定会话 key（`coach_main`），WS 走 `/ws/browser/coach_main`，**带 sidecar 持久化**（区别于 `createTrendSession` 的 ephemeral `trends_` 路径）→ 历史跨轮、跨重载存活。这是对 ADR-008 持久化机制的扩展：把"会话身份"从"必须有 workId"放宽到"workless 但有稳定 key"。

3. **send 与 model 路径从 WS 帧解耦，走 HTTP。** `useChatSocket` 增加 `sendOverride`：coach 模式下 send 走 `POST /api/coach/message`（首轮 spin up grounded session），不是裸 WS 帧。model 走 `POST /api/coach/model`——**session 级作用域**，绝不碰剪辑 agent 骑的全局 `config.model`。这修掉了"两个 agent 抢全局档位"。

4. **grounding 是硬要求，不是装饰。** coach 的 system prompt 必须装载创作者的**真实**上下文：9 件本地作品（含真实 play/digg/comment）+ 选定平台的趋势 artifact + config 兴趣/嗓音（`src/domain/coach-context.ts` 统一组装）。薄数据时**坦诚说明**（"趋势这一期暂无，以你的作品表现 + 兴趣为主要依据"），不编造——与 invariant 8 一致。E2E 实证：coach 回复逐字引用"lights on the street 点赞率 6.2%"等真实指标。

5. **成本护栏。** coach 每会话 token 预算 + 惰性上下文加载（不每轮重读全部作品）+ 只读/建议契约（coach 不直接改作品）。

6. **一键 idea→work 复用 #65，但发起面不同。** coach 流式吐 `<coach-idea title/hook/why>` 标签；前端 `parseCoachIdeas` + `buildCoachIdeaTopicHint`（#65 `buildTrendTopicHint` 的兄弟）把选中的 idea 落成新 work（reuse `useCreateWork`）。注意发起面是 **chat 输出**而非趋势行，是 #65 之上的新接线。

### 备选（已否决）

- **A. 复用 `createTrendSession` 的 `trends_` ephemeral 路径直接挂 UI。** 上手最快，但它**故意无 history**——用户要的持久策略对话拿不到记忆，每次从零。否决（但保留其 system prompt 作为 coach persona 的模板起点）。
- **B. 把 coach 做成一个特殊 work（`coach` content type）。** 能直接复用 ADR-008 的 `(workId, sessionId)` 持久化，但会污染 works 列表/网格、且 coach 没有 deliverable yaml（违反 invariant 3 的"work = 有 SSoT yaml"假设）。否决，改为 workless 持久会话（决策 #2）。
- **C. coach 复用剪辑 agent 的全局 model 设置。** 实现省事，但两个并存的 agent 表面共享全局 `config.model` → 切 coach 档位会偷走剪辑 agent 的档位。否决，改 session 级作用域（决策 #3）。

## Consequences

### Positive
- **唤醒一个已建好却 dark 的能力**——这是"接线 + persona 设计"，不是从零造。
- **聊天栈正式 persona-agnostic 化**：解耦 `workId` 后，ChatPanel 能托管任意 persona，为未来更多 agent 表面（如 Studio 内的不同助手）铺路。
- **达成 PRD-0006 命题核心**：灵感页从被动趋势浏览变成可对话的创作副驾；diagnostic-over-your-works（连 vidIQ 都没完全做到）由本地 agent + 本地作品实现。

### Negative / 成本
- **解耦 ChatPanel↔workId 是真实工作量**：history seed / 附件上传目标 / checkpoint 回滚 / viewer-context 四处都按 workId 取，要逐一让出。
- **新增第二条 model 作用域**（session 级）与既有全局 `config.model` 并存——多一处状态要协调。
- **持久 coach 会话是新的磁盘产物**（`~/.autoviral/works/coach_main/chat.json`）——不在 works.yaml 索引里，删 work 的逻辑要绕开它。

### Neutral
- 不改 ADR-005 的结论：Studio 右栏仍是 Chat/Terminal 双入口、Chat 仍 claude-code-only（coach 同样 spawn `claude -p`，多后端 coach 同样 deferred 到 0.2.0）。
- coach 内容当前 zh-only，不随界面语言切换（已知非阻塞缺口，留待后续）。

---

> **已采纳（2026-06-08，随 v0.1.5 发布回填）**：coach 已挂灵感页并经 2 轮浏览器 E2E 验证（发真消息→流式 grounded 回复 + 一键 idea→work 双路径走通）。

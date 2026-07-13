# ADR-013: Chat 多后端架构 — ChatBackend 接缝、per-session 后端钉定、resume lineage 不互通、认证自理

- **Status:** Accepted
- **Date:** 2026-07-02（Proposed — PRD-0010 Wave C）· 2026-07-03（Accepted — nanxingw 拍板）
- **Deciders:** nanxingw + AI design partner（PRD-0010 v0.1.8）
- **Related:** [ADR-005](ADR-005-dual-chat-entry-layout.md)（Chat｜Terminal 右栏布局 — 本 ADR 给 **Chat** 面加第二后端）· [ADR-008](ADR-008-multi-session-chat-terminal.md)（`(workId, sessionId)` keying — backend 是与 `cliSessionId` 并列的新 per-session 属性）· [ADR-007](ADR-007-single-media-provider-registry.md)（单一 registry-of-plugins 模式 — 本 ADR 把同一模式用到 chat backend）
- **Resolves:** [PRD-0010](../prd/0010-v0.1.8-chat-codex-cost-canvas.md) Wave C（C2 接口抽取 / C3 codex 实现 / C4 per-session 切换）

## Context

[CONTEXT.md](../../CONTEXT.md) 不变量 #4 长期把「multi-backend Chat」推迟到 0.2.0：Terminal 面从一开始就 skill-agnostic（任何 CLI agent 经 pty + bridge 驱动），但 **Chat 面只 spawn `claude -p`**——这是整个「agent-agnostic 工位」命题里唯一一处 claude-code-only 的表面，是被 [ADR-005](ADR-005-dual-chat-entry-layout.md) 承认的 intended-default gap。PRD-0010 把它提前到 v0.1.8 落地。

**改动前的实测现状（grep 核出，非 PRD 传闻）：**

- `spawnCli` 是 `src/ws-bridge.ts` 里的**单一 chokepoint**，硬编码了 claude 的 spawn 形态（`-p` + `--output-format stream-json` NDJSON）与逐帧解析。
- 会话身份已经是 `(workId, sessionId)`（[ADR-008](ADR-008-multi-session-chat-terminal.md)），`cliSessionId` 存 claude 的 `--resume` UUID。
- WsBridge 承担了一切「会话形状」的职责：browser socket 广播、`messageHistory`、`.sessions.jsonl` sidecar / `cliSessionId` 记账、cost ledger、checkpoint、memory sync、进程生命周期（exit/error）。

**设计张力**：要接入第二后端（codex）**又不把 WsBridge 的会话编排 fork 成两份**。codex 与 claude 的差异集中在四点：① `exec --json` 的 JSONL 事件 schema ≠ claude 的 stream-json；② resume 走 `exec resume` 子命令 ≠ `--resume` 旗标；③ 无 `--append-system-prompt` 等价物；④ 只报 token 用量、无 per-turn USD；⑤ 需要交互式登录（`auth.json`）。

## Decision

**在 spawnCli chokepoint 上抽出 `ChatBackend` 接缝，并把 backend 钉成 per-session 属性。四条规则锁死它：**

### 1. ChatBackend 接口 = spawn + parse 两件事，会话编排全留 WsBridge（C2）

`src/server/chat-backends/types.ts` 的 `ChatBackend` 只拥有两个 CLI-specific 关切：

- `buildSpawn(input)` — 把逻辑输入（prompt / resumeId / 补教学 append / model + workId / port）变成 `child_process.spawn` 要的精确 `{ cmd, args, options }`。
- `createLineParser(cb)` — 把该后端的流式 stdout 翻译成**统一的 `ChatStreamCallbacks`**（`onSessionId` / `onText` / `onThinking` / `onToolUse` / `onToolResult` / `onTurnComplete` / `onOther`），使 WsBridge 的 dispatch **只写一次、跨后端复用**。

claude 实现（`claude.ts`）是旧内联逻辑的**纯平移，行为零变化**，用快照测试锁死。`registry.ts` 把 id → impl 做成一张小表，claude 兜底（与 [ADR-007](ADR-007-single-media-provider-registry.md) 的 MediaProvider registry 同构）。

### 2. backend 是 per-session 属性，resume 不互通 → 首轮后不可变（C4）

backend 存 `SessionRecord.backend`（sidecar round-trip）+ `WsSession.backend`。**legacy 记录无此字段 → 默认 claude**（`resolveBackendId` 对未知/缺失一律回 claude，永不抛、永不静默 spawn 错的 CLI）。`cliSessionId` 复用为通用 resume id，但 **claude 与 codex 的 resume id 不可互换**——所以 backend 在**新建会话时选定**，一旦会话有了对话就锁死（`BackendSwitcher` UI 禁用切换）。「切换」的语义永远是**开新对话**，绝不是静默移植上下文。`ModelSwitcher` 升级为 backend+tier 两级选择。

### 3. codex 后端实现：exec --json / resume 子命令 / 归一 parser / prompt 分支（C3）

`codex.ts` 用 `codex exec --json` spawn + `codex exec resume <id>` 子命令 resume + JSONL parser 归一进**同一套 callbacks**。权限走**全放开模式** `--dangerously-bypass-approvals-and-sandbox`（claude `--dangerously-skip-permissions` 的等价物——本地单用户工位哲学的 accepted-risk，与 [ADR-011](ADR-011-douyin-collector-managed-venv-scrape.md) 的 local-first 立场一致）。**C1 实测 fixture 锁定的 gotcha（codex-cli 0.142.4）**：① `exec resume` 拒绝 `-s/--sandbox` 与 `-C/--cd`（复用首轮 sandbox+cwd），buildSpawn 绝不把它们抄到 resume；② reasoning 无独立 item 事件、只在 `turn.completed.usage.reasoning_output_tokens`；③ 无 `--append-system-prompt`，故补教学**前缀拼进 wire prompt**。system prompt 分支：codex 版用 `autoviral docs` 加载手册（无 `Skill` 工具），**viewer-action 语法与 deliverable 契约章节 backend-agnostic、逐字共享**。未知 codex 事件类型（`file_change` / `mcp_tool_call` / `web_search` / …）**优雅降级到 `onOther`，绝不 crash**（`item.type` 是 OPEN set）。

### 4. 认证 per-backend 自理，成本诚实（C3/C4）

每个 backend 自带 ENOENT 文案（命名正确的二进制）+ 可选的 spawn 前 `checkAuth`。codex 实现 `checkCodexAuth`——探 `<codexHome>/auth.json`（认 `OPENAI_API_KEY` 或 `tokens` 对象），未登录时返回「到 Terminal 跑 `codex login`」引导文案（登录是交互式的，daemon 做不了）。claude 不实现 `checkAuth`（claude CLI 自理认证）。

> **接线状态（2026-07-03，诚实标注）**：`checkCodexAuth` 探测能力**已落地并有单测覆盖**（`src/server/chat-backends/codex.ts` + `codex.test.ts`），但 WsBridge 的 **spawn-time 登录 gate 尚未接入**——`spawnCli`（`src/ws-bridge.ts`）今天直接 `backend.buildSpawn → spawn`，**从不**调 `checkAuth`。后果：未登录就选 codex 的会话仍会拿到 codex CLI 自身的隐晦报错，而非上面承诺的引导文案。把 gate 接进 `spawnCli`（spawn 前 `const s = await backend.checkAuth?.(); if (s && !s.ok) { 广播引导文案; return; }`）是 C3/C4 后端工作的**后续片**，不在本 ADR 落地的 docs 片（C5）范围内。CONTEXT.md 不变量 #4 与 `ChatBackend.checkAuth` 接口注释均按此现状标注，避免过期承诺。**成本诚实**：codex 报 token 但无 per-turn USD，所以 C4 用量徽章对 codex 会话是 **token-only、不做本地价格折算**（不变量 #8 诚实纪律）。

### 范围声明

后端选择**只作用于 Studio Chat 面的 per-session 选择**。Terminal 面从来就 skill-agnostic（任何 CLI），不受影响。

## 备选（已否决）

- **A. 为 codex fork 一个专用 bridge / 把 WsBridge 复制两份。** 会重复所有会话编排（广播/记账/sidecar/checkpoint/memory/cost），必然漂移。否决——抽接缝、编排写一次。
- **B. backend 做成全局/app 级设置（非 per-session）。** 用户要的是「留着一个 claude 对话、并排开一个 codex」；全局会强迫所有 work/会话共用一个后端、切换即毁上下文。否决——per-session。
- **C. 允许对话中途切后端（移植历史）。** claude 与 codex 的 resume id/历史不互通，静默丢上下文的「切换」是谎。否决——切换=开新会话，显式。
- **D. 给 codex 本地 USD 估算（价格表）。** 无可靠 per-turn 价，猜测违反诚实不变量。否决——token-only 徽章。
- **E. daemon 自动跑 `codex login`。** 登录是交互式（浏览器/API-key 流程），daemon 做不了。否决——引导到 Terminal。

## Consequences

### Positive

- **最后一处 claude-only 表面拿到第二后端而不 fork 会话编排**——WsBridge dispatch 写一次、跨后端复用。
- **registry 形状让第三后端（kimi/gemini/aider）= 一份 ChatBackend impl + fixture**，不是 bridge 重写。
- **认证与成本都诚实**——codex token-only 徽章、spawn 前登录引导、per-binary ENOENT 文案。

### Negative / 成本

- codex JSONL schema 是 OPEN set、锚在单一实测版本（0.142.4）；codex-cli 改事件形状会静默降级到 `onOther`——C1 fixture 是回归网，codex 升级时必须刷新。
- 两个后端 = 两套认证/权限故事要各自维护文档。
- per-session backend 不可变是 UI 必须持续守的硬规则（切换 UI 出 bug 会重开「静默移植上下文」的窗口）。

### Neutral

- CONTEXT 不变量 #4 的「multi-backend Chat deferred to 0.2.0」条款退役——Chat 在 v0.1.8 已多后端；不变量剩下的「Terminal skill-agnostic」核心不变。
- 不碰 [ADR-002](ADR-002-renderer-stays-remotion.md) 渲染层、不碰 [ADR-012](ADR-012-scenes-as-plan-layer.md) 规划层；纯粹是 chat-agent 传输层。

---

> **已采纳（2026-07-03）**：C2（接口抽取+claude 平移，快照零 diff）/ C3（codex spawn+parser+resume+prompt 分支+登录检测能力 `checkCodexAuth`——spawn-time gate 待接线，见 §4）/ C4（per-session 切换+BackendSwitcher+token-only 徽章）已实现并经绿门。多纬度浏览器 E2E（CE）按 PRD-0010 铁律经 Workflow 编排验收。

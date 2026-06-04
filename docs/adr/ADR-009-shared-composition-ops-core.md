# ADR-009: Shared composition-ops core — 意图级 mutation 单一实现，store + bridge 共消费

- **Status:** Accepted
- **Date:** 2026-06-04（Proposed）· 2026-06-04（Accepted — nanxingw 拍板）
- **Deciders:** nanxingw + AI design partner（PRD-0004 调研 + 模块设计核对）
- **Related:** [ADR-001](ADR-001-autoviral-owns-the-editing-layer.md)（AutoViral 自有编辑层）· [ADR-002](ADR-002-renderer-stays-remotion.md)（渲染留 Remotion）
- **Resolves:** [PRD-0004](../prd/0004-v0.1.3-wire-the-nle-to-agents.md) keystone（M1）— HITL gate；解锁 issue 切片 S6–S10 / S12 / S17（见 [0004-issue-slices](../prd/0004-v0.1.3-issue-slices.md)）

## Context

[PRD-0004 调研](../research/2026-06-04-editing-gap-analysis.md)（17-agent workflow）坐实：AutoViral 在浏览器里已是一台真正可用的多轨 NLE，但核心命题「任意 CLI agent 经 `autoviral` CLI 驱动剪辑」在**写路径**上几乎落空——意图级编辑能力是 *built-but-human-only*。

具体的代码事实：

1. **意图级 mutation 只活在前端 `web/src/features/studio/store.ts`**。约 11 个成熟的意图级 action 全是 UI-only：`addClip` / `updateClip` / `removeClip` / `splitClip(clipId, atSec)` / `trimClip` / `moveClipToTrack(clipId, targetTrackId)` / `addTransition` / `updateTransition` / `removeTransition` / `addTrack(kind, opts) -> trackId` / `removeTrack`。它们封装了大量**写路径 invariant**：`trk_` / clip id mint、transition `afterClipId` 非末位（`composition.ts` 的 `superRefine`）、split/trim 的 keyframe 重基、speed clamp（0.1–4.0）、跨轨同 kind 守卫、移动后源轨 transition 孤儿 prune。

2. **后端 bridge 够不着这些**。`src/server/bridge/routes.ts` 的写面只有 `clip add/set/remove` + `carousel add-slide/set-layer`，**没有任何** split / trim / move / transition / track 动词。routes.ts 自己的注释（:524）承认："agents that need richer mutations (split clips, reframe, smart-crop) compose them client-side and POST the resulting full composition"。

3. **现有 `PATCH /clip` 是 `{...cl, ...patch}` 浅合并**，而 `composition.ts` 全文无 `.strict()` → 未知/嵌套 key 被 zod 静默 strip（PRD-0004 硬伤 #4）。

如果按最直接的办法"在后端 bridge 里把 split/trim/move 再实现一遍"，就会出现**前后端两套意图 mutation 实现各自漂移**——同一个 invariant（比如 transition 非末位、keyframe 重基）要在两处维护，迟早不一致。调研报告把这点明确列为风险。

关键约束：**两个消费方的宿主形态不同**。
- store 用 **immer**（`zustand/middleware/immer`，`set((s) => { ...mutate s.comp... })`，draft 是可变 proxy）。
- bridge 用 **read-modify-write**：`mutateCompositionFor(ctx, (comp) => { ...; return comp })`，对一个 `CompositionSchema.parse` 出来的普通对象操作，最后再 `CompositionSchema.parse` 落盘（`src/server/bridge/composition-ops.ts` 是唯一写 chokepoint）。

`@shared/*` 别名映射到 `src/shared/*`（`web/tsconfig.json`），前端经 alias、后端经相对路径**共享同一份 `src/shared/`**——已是天然的共享落点。

## Decision

**把意图级 mutation 提取成一个共享核心 `src/shared/composition/ops`，作为纯（无 I/O）的"原地 mutation"函数集合，前端 store 与后端 bridge 共消费同一份实现。** PRD-0004 的 M2（`patch`，deep-merge + per-kind 白名单）与 M3（`preflight`，候选 comp 校验）作为同目录兄弟模块，受本 ADR 的 `@shared/composition/` 布局约束。

### 契约

```ts
// src/shared/composition/ops —— 意图级 mutation 核心
// 风格：原地 mutate 传入的 Composition；返回 mint 出的 id（若有）。
// 对 immer draft 与 bridge parsed object 都成立（draft 是可变 proxy）。

class CompositionOpError extends Error {
  constructor(message: string, readonly code: number) { super(message) }
}

// 示例签名（逐片增量长出，不一次性全提）：
function splitClip(comp: Composition, p: { clipId: string; atSec: number }): { newClipId: string }
function trimClip(comp: Composition, p: { clipId: string; in?: number; out?: number }): void
function moveClipToTrack(comp: Composition, p: { clipId: string; targetTrackId: string }): void
function addTransition(comp: Composition, p: { trackId: string; afterClipId: string; preset: string; durationSec: number }): { transitionId: string }
function addTrack(comp: Composition, p: { kind: Track["kind"]; /* opts */ }): { trackId: string }
// ...removeClip / removeTransition / removeTrack / setClipProps(经 patch) 同理

// 消费方包一层：
// store:  set((s) => { ops.splitClip(s.comp, p) })             // immer draft
// bridge: await mutateCompositionFor(ctx, (comp) => { ops.splitClip(comp, p); return comp })
```

### 本 ADR 锁定的决策

1. **原地 mutate，不返回新对象。** ops 是 `(comp, params) => mintedId | void`，原地改 `comp`。这是被两个宿主形态夹出来的最小公约数：immer draft 是可变 proxy（原地改保留结构共享）；bridge 的 parsed object 直接改即可。若选函数式 `(comp) => newComp`，immer 侧会丢结构共享、且要 `s.comp = ops.split(...)` 重新赋值（还可能与 immer 的 draft 语义打架）。**ops 内绝不替换 `comp` 引用本身**（只改其字段），否则 immer draft 失效。

2. **纯于 I/O，不纯于 mutation。** ops 内**无** fs / http / 网络；也**不**自己跑 `CompositionSchema.parse`（保持快、可在 draft 中途调用）。最终 zod 校验仍只在 bridge chokepoint（`writeCompositionFor`）和前端的既有时机做。ops 负责的是**结构正确性**（见 #3）。

3. **invariant 收归 ops，单一事实源。** 当前散在 store 各 action 里的写路径 invariant——`trk_`/clip id mint、transition `afterClipId` 非末位、split/trim 的 keyframe 重基、speed clamp、跨轨同 kind 守卫、移动后源轨 transition 孤儿 prune——全部下沉进 ops 并在此集中文档化。非法参数（如在 clip 外 split、跨 kind move）**throw `CompositionOpError{code}`**，不静默吞。这是消除前后端漂移的正面收益。

4. **typed error 带 `code`。** `CompositionOpError extends Error { code }`。bridge 把 `.code` 透传进 HTTP/JSON 响应（对齐 PRD-0004 S3 错误码契约，输入/校验类 → 4）；store 把它 surface 成 toast。

5. **位置 `src/shared/composition/`**：`ops`（本 ADR 核心）、`patch`（M2，deep-merge + per-kind 白名单，被 `setClipProps` 与 PATCH 路由复用）、`preflight`（M3，候选 comp 纯校验）三个兄弟模块。前端经 `@shared/composition/*`、后端经相对路径共享。底层 zod schema 仍留 `src/shared/composition.ts`——ops 坐在 schema **之上**，不与之合并。

6. **store 切换为调 ops，且现有 store 测试须全绿（零行为变化）作为提取的安全网。** 每个意图 action 从"内联实现"改为"调 `ops.*`"后，对应的现有 store 单测不得改断言即通过——这是提取没改坏行为的证据。

7. **增量长出，不 big-bang。** ops 集合按 issue 切片逐个生长：S6 提 `splitClip` 顺带建骨架，S7 加 `trimClip`，S8 加 `moveClipToTrack`……不要求一次性提完 11 个。

### 备选（已否决）

- **A. 后端独立重实现意图 ops。** 上手快，但前后端两套实现 + 两套 invariant 维护 = 调研点名的漂移源。否决。
- **B. 只给整份 comp PUT，不做 per-intent ops。** agent 必须手搓整份合法 comp 并在 prompt 里重新编码所有 invariant。作为**唯一**方案否决；但整份 PUT 仍保留为逃生口（PRD-0004 S4 `comp put`），与 ops 并存。
- **C. ops 只放后端，前端每次编辑都打后端。** 引入往返延迟、破坏乐观 UI、live 编辑的 SSoT 本就是前端 store。否决。

## Consequences

### Positive

- **单一事实源，永久消除前后端意图 mutation 漂移**——invariant 改一处即两端生效。
- **ops 可在隔离中单测**（纯函数、无 I/O），一份测试同时为 store 与 bridge 背书（PRD-0004 测试决策把 M1 ops 列为最高 ROI 测试目标）。
- **agent 写路径与 UI 达到能力对等**——bridge 动词只是 ops 之上的薄适配，CLI agent 终于够得着 split/trim/move/transition/track。
- **写路径 invariant 第一次被集中文档化**（此前散落、且只在读路径自动兜底，写路径是隐形地雷——PRD-0004 硬伤 #15）。

### Negative / 成本

- **前端 store 需一次性重构**为调 ops；风险由"现有 store 测试须全绿"兜底（决策 #6）。
- **immer 耦合约束**：ops 必须原地改字段、绝不替换 `comp` 引用，否则 immer draft 失效——这是写 ops 时要守的纪律（已写进决策 #1）。
- ops 与底层 zod schema 是两层，新增可动属性时要两处协调（schema 加字段 + ops 懂它）——但这是有意的分层，不是债。

### Neutral

- ops 增量生长，bridge 动词与 CLI 动词随之逐片补齐；在补全前，整份 `comp put`（S4）是 agent 做任意富改动的现实逃生口。
- 不改变 ADR-001/002：编辑层仍 AutoViral 自有、渲染仍 Remotion；本 ADR 只规定意图 mutation 的**实现归属**。

---

> **已采纳（2026-06-04）**：nanxingw review 通过。S6（`clip split`，建立 ops 骨架）已解锁；按依赖图先做 S2（写路径 broadcast，S6 的 demo 前置）。

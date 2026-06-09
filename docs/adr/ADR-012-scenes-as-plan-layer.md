# ADR-012: Scenes as the plan layer — 剧本→分镜→生成 handoff、共享 scene ops、per-work 写锁

- **Status:** Accepted
- **Date:** 2026-06-09（Proposed）· 2026-06-09（Accepted — nanxingw 拍板）
- **Deciders:** nanxingw + AI design partner（PRD-0007 调研 `wf_0013f6d7-57b` + spec review `a0f3e214`）
- **Related:** [ADR-009](ADR-009-shared-composition-ops-core.md)（共享 composition-ops 核心 — 本 ADR 把同一模式延伸到 scenes）· [ADR-001](ADR-001-autoviral-owns-the-editing-layer.md)（AutoViral 自有编辑层）
- **Resolves:** [PRD-0007](../prd/0007-v0.1.6-script-storyboard-planning.md) keystone（S1）+ S6（写锁）+ S7（生成 handoff）

## Context

AutoViral 把自己重定位为「电影级 AI-native 万能视频生成器」（L0–L4 roadmap）。v0.1.6 专做 **L1 规划层**：生成之前先排剧本（md）+ 在素材区看到逐镜分镜表 + 一幕一幕生成。

代码事实（PRD-0007 调研核出）：

1. **`SceneSchema` 与 `plan/*.md` 是 built-not-wired**——schema 里有一个单层 `Scene` 雏形，`plan/` 目录约定存在，但没有任何 ops、路由、UI、CLI 把它们接起来。
2. **生成路径不对称（悬挂引用风险）**：video 经 `/api/providers/:id/generate-video`（`generate.ts:547-574`）会写 `AssetEntry` + `ProvenanceEdge`；但 image `/api/generate/image`（`generate.ts:37-83`）**只广播 `asset-added`、不写 `composition.assets`**。任何「把生成产物回链到分镜」的实现若直接把 image 的 id 塞进 `scene.generatedAssetIds`，就会指向 `composition.assets` 里不存在的 id = 悬挂引用。
3. **`mutateCompositionFor` 当时无锁**：同一 work 的并发 read-modify-write 会丢写（lost update），而「分镜编辑 + 生成回链 + agent 同时改」正是会制造并发写的场景。

设计张力：分镜既要能被 **agent 经 CLI/bridge** 创建，又要能被 **人在 UI** 编辑，两条路径必须落到同一份 `composition.yaml scenes[]`（命题核心：agent-人一致）。同时「生成此幕」绝不能把规划层变成又一个生成驾驶舱。

## Decision

**把 scenes 确立为「剧本 → 生成」之间的规划层（plan layer），用三条规则锁死它：**

### 1. Scene = 单层、ops 化、与 clip ops 同构（延伸 ADR-009）

升级 `SceneSchema` 为 8 字段单层结构（`intent` / `prompt` / `narration` / `durationSec` / `shotSize` / `cameraMovement` / `mdAnchor` + 生成态 `generatedAssetIds` / `selectedAssetId` / `status`），向后兼容（旧 work 无 `scenes` 键原样 parse）。意图级 scene mutation 收归 `src/shared/composition/ops/scene.ts` 的五个动词——`addScene` / `setSceneProps` / `reorderScenes` / `linkSceneAssets` / `removeScene`——作为 store / bridge 路由 / `autoviral scene …` CLI **共消费的单一实现**（ADR-009 模式延伸到 scenes）。`order` 完全由 ops 拥有（addScene 自动分配、reorder/remove 连号 0..N-1），调用方从不传。清空可选字段走 **null-clear 协议**（`null`=删、`undefined`=不改，因 `JSON.stringify` 丢 undefined）。

### 2. 生成是 handoff，不是引擎；register+link 原子化（消除悬挂引用）

「生成此幕」`POST /api/bridge/v1/scene/:id/generate` 用该镜**自身字段**（prompt 富化 景别/运镜/旁白）调**现有生成流程**——规划层不拥有生成引擎、不管它同步异步、不建异步队列。慢的 provider 调用在锁**外**；产物落盘后，**在同一个 `mutateCompositionFor` 锁内 mutator 里**先 `register AssetEntry`（补 image 路径的登记缺口）+ `ProvenanceEdge`，再 `linkSceneAssets` 回链——register 与 link 原子提交，故 `generatedAssetIds` 永不指向 `composition.assets` 缺失的 id（**无悬挂引用**，这是 S7 的 keystone）。归属靠**请求-响应一一对应**（`asset-added` 广播不带 sceneId，不用它做归属）。改画面描述后 `status→stale`（脏标记只标被改的这一镜，逻辑在 `setSceneProps` op 里 → 三条驱动路径一致）。「重拍」= 再调一次，append take。产物只回填 `scene.generatedAssetIds`/`selectedAssetId`，**不自动铺 timeline**（规划层与 timeline 解耦，避免覆盖已精剪结果）。

### 3. 每次 composition 写经 per-work 写锁（lost-update fix）

`mutateCompositionFor` 用 `withWorkLock(workId)` 串行化整个 read-modify-write 临界区：同一 work 的并发写读到上一笔已提交状态，不同 work 并行（独立队列）。整份 `PUT /comp` 与 `POST /restore` 也经 identity-mutator 入锁。

## 备选（已否决）

- **A. 生成内嵌驾驶舱 / 自建异步队列。** 把规划层做成第二个生成中心 = 范围爆炸 + 与既有生成流程双实现漂移。否决——生成只做 handoff。
- **B. image 生成端点就地补登记（改 `/api/generate/image`）。** 会改动 GenerationDialog 共用的端点、风险扩散。否决——在 scene-generate 端点的锁内 mutator 里登记，自包含的「register→link」单一可靠链路。
- **C. stale 逻辑放在路由/store 而非 op。** 会让 CLI 编辑与 UI 编辑的脏标记行为漂移。否决——放在 `setSceneProps` op，三端一致（ADR-009 精神）。
- **D. scenes 自动铺上 timeline。** 会覆盖用户已精剪的结果。否决——计划层与 timeline 解耦，铺轨是用户的显式决策。

## Consequences

### Positive

- **agent 与人在分镜上能力对等**——同一份 scene ops，CLI 排镜与 UI 改卡收敛到同一 `composition.yaml`。
- **生成回链无悬挂引用**——register+link 原子化，是被对抗式 review 反复盯死的 keystone。
- **并发写不再丢**——per-work 写锁覆盖所有 composition 写路径。
- **规划与执行解耦**——生成不拥有引擎、不碰 timeline；剧本与分镜两个独立面，弱链于 `mdAnchor`，诚实呈现 drift。

### Negative / 成本

- scene ops 与底层 zod schema 是两层，新增可动字段要两处协调（schema 加字段 + op 懂它 + setSceneProps 白名单）——有意的分层。
- 生成端点把 provider 调用放锁外、register+link 放锁内，是要守的纪律（写错会重开悬挂引用窗口）。
- 写锁串行化同一 work 的写——可接受（单用户工位 + 不同 work 并行）。

### Neutral

- 不改 ADR-001/002：编辑层仍自有、渲染仍 Remotion。本 ADR 只规定**规划层**的归属与三条不变量。
- mdAnchor 是 weak link，剧本/分镜不强一致——故意如此（各自演进，UI 显 drift notice）。

---

> **已采纳（2026-06-09）**：S1（keystone schema+ops）/ S6（写锁）/ S7（生成 handoff）已实现并经绿门 + 多纬度浏览器 E2E 验收。

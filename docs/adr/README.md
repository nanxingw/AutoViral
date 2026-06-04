# ADR · 架构决策记录

> ADR（Architecture Decision Record）回答一个问题：**为什么选这个架构、当时权衡了什么**。它是 PRD 的下游补充——PRD 写「为谁建什么 + 验收口径」（产品/治理视角），ADR 写「为什么是这个架构选择」（架构视角）。一份 PRD 里若出现需要锁定的架构选择，把它独立成 ADR 并在 PRD 里链过去——不要把架构论证塞进 PRD 正文。

---

## 约定

- **位置**：所有 ADR 落在 `docs/adr/` 下，平铺。
- **命名**：`ADR-NNN-slug.md`，三位单调递增序号 + 短横线小写标题（如 `ADR-001-autoviral-owns-the-editing-layer.md`）。序号一旦分配不复用、不回填；新 ADR 取「当前最大序号 + 1」。
- **新增 ADR 必须登记本表**：建好 ADR 文件后，回到本表补一行（编号 | 标题 | 状态 | 日期），保持索引不漂移。
- **状态机**：`Proposed → Accepted → Deprecated / Superseded`。
  - `Proposed` — 提案中，尚未拍板。
  - `Accepted` — 已采纳，是当前生效的决策。
  - `Deprecated` — 不再推荐，但未被某份具体 ADR 取代。
  - `Superseded` — 被更新的 ADR 取代（在头部注明取代它的 ADR 编号）。
- **决策被取代时，写一份新 ADR 标记旧的为 `Superseded`，不要回去改旧 ADR 的正文**——ADR 反映的是写作当时的权衡，故意保持原样。详见 [`../README.md`](../README.md) 的「不要『纠正』历史归档与 ADR 的内容」。

---

## 现有 ADR

| 编号 | 标题 | 状态 | 日期 |
|---|---|---|---|
| [ADR-001](ADR-001-autoviral-owns-the-editing-layer.md) | AutoViral owns the editing layer（自有 Remotion 编辑栈，不桥接 hyperframes） | Accepted | 2026-05-15 |
| [ADR-002](ADR-002-renderer-stays-remotion.md) | Renderer stays Remotion（渲染层保持 Remotion JSX，不换 HTML+CSS+GSAP） | Accepted | 2026-05-15 |
| [ADR-003](ADR-003-sibling-skill-split.md) | Sibling skill split — taste vs engineering（taste 与 engineering 两类兄弟 skill 分流） | Accepted | 2026-05-15 |
| [ADR-004](ADR-004-mattpocock-replaces-superpowers.md) | Adopt mattpocock skills, retire superpowers in this project（本仓用 mattpocock 取代 superpowers） | Accepted | 2026-05-15 |
| [ADR-005](ADR-005-dual-chat-entry-layout.md) | Studio 右栏用水平 tab 切换器（Chat \| Terminal），默认 Chat | Accepted（多会话维度被 ADR-008 收窄）| 2026-05-17 |
| [ADR-006](ADR-006-content-type-registry.md) | ContentTypeRegistry — 内容类型的中央清单（v0.1.1 深模块 ①） | Accepted | 2026-06-03 |
| [ADR-007](ADR-007-single-media-provider-registry.md) | Single MediaProvider registry — 能力标签、单一入口（v0.1.1 深模块 ②） | Accepted | 2026-06-03 |
| [ADR-008](ADR-008-multi-session-chat-terminal.md) | 多会话 Chat + Terminal — `(workId, sessionId)` keying、sidecar 持久化、focus 共享（v0.1.2 §5 keystone） | Accepted | 2026-06-04 |
| [ADR-009](ADR-009-shared-composition-ops-core.md) | Shared composition-ops core — 意图级 mutation 单一实现、原地 mutate、store + bridge 共消费（v0.1.3 keystone / PRD-0004 M1） | Proposed | 2026-06-04 |

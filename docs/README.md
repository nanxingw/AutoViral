# AutoViral · 文档地图

> 这是 `docs/` 的统一入口，也是任何 agent（claude / codex / kimi / gemini / aider）或新 dev 的**第一站**。先在这里搞清楚「现在在建什么、为什么这么建、东西放在哪」，再往下钻。

AutoViral 是一个常驻 Node daemon（`node dist/index.js start`，端口 3271）+ Vite/React Studio SPA（`web/dist`）+ HTTP/WS API 组成的创作工位：用户在 Studio 里剪短视频 / 图文 / 海报，任意 CLI agent 在 Studio 终端里加载操作手册 skill（`skills/autoviral/`）并调用 `autoviral` 协议层 CLI 来驱动这个工位。产品形态正在收敛为 `autoviral@0.1.0`（npm 分发 CLI + Electron 桌面壳），包管理器统一 npm。

---

## 先读这几份

按优先级从高到低，这几份文档构成项目的「宪法」。任何冲突以**靠上**的为准。

| 文档 | 里面是什么 | 为什么先读 |
|---|---|---|
| [`/README.md`](../README.md) | 项目门面：它能做什么、快速开始、provider/架构/目录现状（已与 0.1.0 对齐） | 新人/新 agent 的第一印象与上手路径；想知道「这是什么、怎么跑起来」时 |
| [`/CLAUDE.md`](../CLAUDE.md) | 项目指令：skill 体系、美学方向、测试纪律、`<rules>`、行为底线（Evidence over agreement / Boil the ocean） | **最高优先级**，覆盖任何 agent 的默认行为；动手前必读 |
| [`/AGENT.md`](../AGENT.md) | 非-Claude CLI agent（codex/kimi/gemini/aider）的项目级入口：薄包装指向 CLAUDE.md / CONTEXT.md 的共享规则 + backend 专属段（build/test、双 agent surface、provider 网关） | 你不是 Claude Code 时先读；它把 CLAUDE.md 钉为同角色 backend 对照，不另写一份规则 |
| [`/CONTEXT.md`](../CONTEXT.md) | 领域词汇表（work / composition / track / clip / bridge / focus …）+ 架构不变量 + 高层 code map | 统一术语、避免发明新词或违反不变量；做任何非平凡改动前必读 |
| [`agents/index.md`](agents/index.md) | mattpocock skill 家族的 per-repo 配置：issue tracker、triage label、领域文档指向 | `to-prd` / `to-issues` / `triage` / `diagnose` 等 skill 据此工作；要走协作流程时读 |

---

## docs/ 目录一览

| 目录 | 里面是什么 | 何时读 |
|---|---|---|
| [`prd/`](prd/) | 产品 / 治理 PRD，`NNNN-slug.md` 单调编号（`0001` 已存在）。回答「为谁建什么、验收标准是什么」，是 issue 的上游 | 想知道某个能力的需求来源、范围边界、验收口径时；写新需求前先看 [`prd/README.md`](prd/README.md) |
| [`adr/`](adr/) | 架构决策记录 `ADR-NNN-*.md`（现有 7 份，索引见 [`adr/README.md`](adr/README.md)）。回答「为什么是这个架构选择、当时权衡了什么」 | 要改架构、质疑某个不变量、或判断一个提案是否与既有决策冲突时 |
| [`agents/`](agents/) | agent 协作约定：`index.md` / `issue-tracker.md` / `triage-labels.md` / `domain.md` | 用 mattpocock skill 建 issue / triage / 发 PRD 时 |
| [`reference/`](reference/) | 长青技术参考（不随单个 feature 失效的事实性资料） | 查某个外部依赖、协议、API 的稳定细节时 |
| [`design/`](design/) | 设计稿与视觉规范（吸收了原拼写错误目录 `desigen/`） | 做 UI / 视觉相关改动、需要对齐美学方向时（配合 CLAUDE.md 的 Aesthetic Direction） |
| [`qa/`](qa/) | 测试 / 验收记录（e2e-report、phase E2E notes 等） | 想知道某个 phase 的端到端验收结论、复盘历史 E2E 教训时 |
| [`archive/`](archive/) | 历史 `plans/` `specs/` `notes/`（原 `docs/superpowers/` 整体迁入，61 份）。**只读历史**，不是当前规范 | 考古某个早期方案、追溯一个决策的演进时；当前进度看 `prd/` 与 `adr/`，不要从这里找「现在该怎么做」 |

> 根目录 `docs/` 下还散落着早期研究 md（`research-*.md`、`how-it-works.md`、`skill-structure-guide.md`）与 `screenshots/` / `assets/`。它们是历史素材，不构成当前规范——`skill-structure-guide.md` 顶部已自标「已过时，仅供历史参考」。

---

## 约定

### Single source of truth — skill manual == `autoviral docs`

操作手册的唯一事实来源是 `skills/autoviral/manual/*.md`。`autoviral docs` CLI 命令的输出就是这些 markdown 的内容——**改文档改 manual，不要在 CLI 里另写一份**。这条约定保证「agent 在终端里查到的」与「仓库里写着的」永远一致。同理，PRD 的发布约定见 [`prd/README.md`](prd/README.md)、版本与 CHANGELOG 约定见 [`/CONTRIBUTING.md`](../CONTRIBUTING.md)。

### 路径迁移 — `docs/superpowers/` 已不存在

历史上 plans / specs / notes 放在 `docs/superpowers/`，已整体 `git mv` 到 [`archive/`](archive/)（`docs/superpowers/plans/` → `docs/archive/plans/`，specs / notes 同理）。如果你在某份文档或源码注释里读到指向 `docs/superpowers/...` 的链接而它打不开，那是漏改的死链——把它修成 `docs/archive/...`，不要据此去重建别人已经写好的方案。这个改名的来龙去脉见 PRD-0001（[`prd/0001-v0.1.0-release-and-conventions.md`](prd/0001-v0.1.0-release-and-conventions.md)）。

### 不要「纠正」历史归档与 ADR 的内容

`archive/` 里的 plans/specs 反映的是**写作当时**的事实与决策，ADR 反映的是**当时**的权衡。它们故意保持原样——即便今天看来过时或被推翻。

- 决策被取代时，写一份新 ADR 标记旧的为 `Superseded`，**不要**回去改旧 ADR 的正文。
- `archive/` 里的过时表述不要「就地修正」；它的价值在于忠实记录历史。
- 唯一例外是上面那条机械的路径迁移（`docs/superpowers/` → `docs/archive/`）——那只是改链接落点，不改任何论断。

特别地，`ADR-004-mattpocock-replaces-superpowers.md` 讲的是「用 mattpocock skill 取代 superpowers skill」这件事本身，与目录改名无关，整篇保留不动。

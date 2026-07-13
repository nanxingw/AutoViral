# ADR-014: 聚焦内容生产，退役 discovery / analytics 产品面

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** nanxingw + AI implementation partner（PRD-0013 S4）
- **Supersedes:** [ADR-010](ADR-010-grounded-coach-persona.md) · [ADR-011](ADR-011-douyin-collector-managed-venv-scrape.md)
- **Related:** [PRD-0013](../prd/0013-studio-focus-and-slimdown-issue-slices.md) S4

## Context

Explore 与 Analytics 把产品扩展成 discovery、平台数据分析和第二 agent persona，同时带来 trends / analytics / coach API、两套后台采集器、独立 CLI 入口、配置字段和磁盘缓存。这些表面偏离 AutoViral 的核心价值：在一个 work 内完成调研、规划、素材生成、编辑和导出。

其中一部分数据源还依赖脆弱抓取或推断，维护成本与用户价值不成比例。继续隐藏 UI 而保留后台服务仍会留下无人使用的 cron、会话、依赖和配置契约，因此需要按完整产品域退役。

## Decision

**AutoViral 聚焦内容生产，退役产品级 discovery / analytics 域。**

1. 移除 Explore / Analytics UI，并为精确旧路径 `/explore`、`/analytics` 保留回到作品首页的兼容跳转；未知路径仍为 404。
2. 移除 trends / analytics / coach API、`autoviral trends` CLI 及 research scheduler / analytics collector 两套后台采集。
3. 旧配置仍可加载，但 research / analytics / interests 及兼容 flat 字段会被忽略且不再回显；启动时不主动重写用户配置。
4. 既有磁盘缓存不会自动删除。此轮不引入自动迁移或 cleanup 命令。
5. 明确保留内容生产链路：新建作品的 `topicHint`、每作品 `research/` 目录、agent 的通用按需 Web research、以及完整 cost ledger。

被删模块的逐文件权威清单见 [PRD-0013 S4](../prd/0013-studio-focus-and-slimdown-issue-slices.md) 的 (a)–(c)：前端页面、queries 与 coach UI；服务端 routes、domain、scheduler、collector、trends 与 CLI；以及仅服务于该产品域的依赖和 setup / doctor 分支。

这是 0.x 阶段有意接受的 breaking 收缩；发布版本号由 PRD-0013 S10 定稿。

## Consequences

### Positive

- 产品与维护边界回到 Works → Studio / Editor → 导出的内容生产主链。
- 删除无人使用的抓取、cron、第二 persona 与专属 API，减少隐性运行成本和故障面。
- agent 仍可围绕当前作品按需调研，研究结果与作品上下文一起留在 `research/`。

### Negative

- 依赖旧页面、API 或 `autoviral trends` 的调用方需要迁移到作品内按需调研。
- 旧配置字段不再生效；遗留缓存需要用户自行决定是否清理。

### Neutral

- ADR-010 与 ADR-011 作为历史决策保留，但状态改为 Superseded。
- ADR-013 的 ChatBackend / per-session backend 决策不变；其已退役的 coach / trends 范围说明被移除。

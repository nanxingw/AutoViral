# AutoViral

## Agent skills

This repo uses three families of agent skill, configured in `docs/agents/`:

1. **AutoViral itself** (`skills/autoviral/`) — operator manual for driving the AutoViral workstation. See "Skill 结构规范" section below.
2. **Engineering / process** (`.agents/skills/` — `mattpocock/*`) — work decomposition + collaboration primitives: `to-prd`, `to-issues`, `triage`, `diagnose`, `tdd`, `prototype`, `zoom-out`, `handoff`, `caveman`, `grill-me`, `grill-with-docs`, `improve-codebase-architecture`, `write-a-skill`, `find-skills`. **This replaces `superpowers:*` in this project** — see [ADR-004](docs/adr/ADR-004-mattpocock-replaces-superpowers.md).
3. **Taste / craft** (sibling skills, not bundled) — bring your own: `editorial-pro`, `viral-hooks-zh`, `lyric-video`, etc.

Key project conventions for these skills:
- **Issue tracker:** GitHub Issues at https://github.com/nanxingw/AutoViral (`gh` CLI). See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).
- **Triage labels:** `needs-triage` / `waiting-on-reporter` / `ready-for-agent` / `ready-for-human` / `wontfix`. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).
- **Domain docs:** [CONTEXT.md](CONTEXT.md) (domain glossary + invariants) + [docs/adr/](docs/adr/) (architecture decisions). See [docs/agents/domain.md](docs/agents/domain.md).
- **Index:** [docs/agents/index.md](docs/agents/index.md).

## Skill 结构规范 (refactor in progress — see refactor/agentic-terminal)

AutoViral 不再把"如何做好视频"作为 skill 内容 —— 那是 commodity（市面有 hyperframes / editorial-pro 等），让用户挂自己喜欢的 taste skill。**AutoViral 的 skill 是"如何操作这个工位"的操作手册**，agent-agnostic markdown，任何 CLI agent（claude / codex / kimi / aider）加载后都能在 Studio 里给用户一流体验。

```
skills/autoviral/
  SKILL.md            # 入口：你在 AutoViral 工位里，能用这些工具
  manual/             # 操作手册 (agent-agnostic markdown)
    00-quickstart.md
    01-workspace-layout.md
    02-composition-schema.md
    03-cli-reference.md   # 同时也是 `autoviral docs` 的内容源
    04-ui-control.md
    05-conventions.md
  recipes/            # 常见任务的 step-by-step pattern
  contracts/          # 错误码 / 事件流 schema
  references/         # 给 power user 的 SDK 直调
```

核心原则：
- **Skill = 操作手册**，不教审美（审美交给 sibling skill）
- **`autoviral` CLI 是协议层**（`cli/autoviral/`），skill 是知识层 —— skill 里教 agent 调 CLI
- **零强制顺序**：agent 按需查文档，不强迫线性流程
- **Single source of truth**：`autoviral docs` 命令输出 = `manual/*.md` 内容

转型实施中。当前进度看 `docs/archive/plans/2026-05-14-agentic-terminal-refactor.md`，协议看 `docs/archive/specs/2026-05-14-agentic-terminal-bridge-protocol.md`。已删除的 `taste/` 和 `modules/` 内容归档在 git tag `pre-skill-rewrite-snapshot`。

旧规则归档：[docs/skill-structure-guide.md](docs/skill-structure-guide.md)（已过时，仅供历史参考）。完整文档地图见 [docs/README.md](docs/README.md)。

## 版本与发布约定

- **包名**：`autoviral`（unscoped），发布到 npm。
- **版本号**：SemVer，整仓单一版本号，当前 `0.1.1`（pre-1.0；0.x 期间 minor bump 可能带破坏性行为变化）。
- **包管理器**：npm（不用 bun / pnpm；已删除 `bun.lock`）。
- **bump 规则**：MAJOR = 破坏性变更 / MINOR = 向后兼容的新功能 / PATCH = 向后兼容的修复（0.x 例外见上）。
- **CHANGELOG**：遵循 [Keep a Changelog](https://keepachangelog.com)，`## [版本] - 日期` 语法是 release notes 的单一事实源。
- **发布**：打 tag `vX.Y.Z` 触发 GitHub Actions release。
- **桌面端**：Electron + electron-builder（mac `dmg` + win `nsis`）。
- **PRD**：全部写在 `docs/prd/`（`NNNN-slug.md`）；完整文档地图见 [docs/README.md](docs/README.md)。

<rules>
启动subagents模式时，所有subagents必须使用Opus模型驱动。
不要随便push代码，但可以commit保证记录
在构建和重构skill时，必须确保自己阅读过https://github.com/obra/superpowers，https://github.com/garrytan/gstack等业界权威skill，对怎么构建skill了如指掌。
https://github.com/pandazki/pneuma-skills是你需要着重参考的项目地址，任何有关视频剪辑和前端设计的问题应该第一时间学习他的设计。
</rules>

<testing>
- **默认一次性运行**：验证代码请用 `npm run test:web`（跑完即退出），不要默认 `test:web:watch`。Server 端同理用 `npm run test:server` 而非 `:watch`。
- **watch 模式仅用于主动调试**：只在反复迭代单个测试文件时短时启用，调完立刻 Ctrl+C，绝不让它常驻后台。
- **vitest worker 必须封顶（两个 pool 都要）**：`web/vitest.config.ts` 的 `poolOptions.threads.maxThreads = 2`，`vitest.server.config.ts` 的 `poolOptions.forks.maxForks = 2`。本机 8 核默认会开 7 个 worker × ~150 MB ≈ 1 GB 常驻，已经炸过两次内存。修改任一 vitest 配置时不要移除这两个上限。
- **pretest 钩子已自动清残留**：`npm run test:web` / `test:server` 启动前会 `pkill -f` 上次同 config 的进程；不要绕过 npm 直接调 `vitest`，否则钩子失效。
- **绝不并发跑两个 vitest**：不要在两个终端同时跑测试，也不要在 watch 还活着时另起一次 run——同一 config 第二次启动会绕开 maxThreads 形成双倍 worker。
- **跑完自检命令**：`pgrep -f vitest | wc -l` 应 ≤ 3（1 主进程 + ≤2 worker）；≥5 立即 `pkill -f vitest` 然后排查。
- **不要用 watch 来"验证我刚改的代码"**：一次性 `test:web` 就足够，watch 只在你主动调试时才有意义。
</testing>

<e2e>
- **E2E 必须经 Workflow 多纬度编排，主 agent 绝不自己执行**（2026-06-04 起）：任何"端到端 / 实际跑一遍 / 从用户视角"的验证，**禁止**主 agent 自己调 `mcp__claude-in-chrome__*` 去点浏览器并 claim 通过。你是**编排者**——设计一个 Workflow，fan-out 多个 subagent，每个从**不同纬度**（用户路径 / 内容类型 / agent-CLI vs 人-UI / 呈现-viewport-theme / 失败边界 / 最后一公里）独立 E2E，各自截图 + DOM 二确，最后一个 completeness-critic subagent 汇总找漏测；你只读结论与证据。
- **浏览器资源不可并发抢**：每个 E2E subagent 先 `tabs_context_mcp` 再 `tabs_create_mcp` 开自己的 tab，不复用别 session 的 tab id；只能串行的资源就在 workflow 里串成 pipeline。
- **通过标准不变**：用户视角（浏览器可见 + DOM/computed-style 二确）是唯一 source of truth，backend artifact 不算数。完整铁律见 [.claude/rules/e2e-testing.md](.claude/rules/e2e-testing.md)。
</e2e>

### Aesthetic Direction
- **调性**：editorial · cool · glass。暗色 #0a0b0f 真中性 / 亮色 #fafaf7 paper-white；噪点 overlay (mix-blend-mode: overlay, opacity 0.035)
- **主色**：`--accent: #a8c5d6`（暗色 cool steel）/ `#2a3a4a`（亮色 deep ink），`--accent-hi`/`-lo`/`-glow` 完整四档
- **字体**：`Inter`（正文，font-feature ss01/cv11）· `Instrument Serif italic`（编辑大字 / 数字徽章）· `JetBrains Mono`（labels / eyebrow / 数据徽章）
- **圆角**：`--radius-sm 6px / --radius-md 10px / --radius-lg 16px / --radius-xl 22px` 四档
- **玻璃**：`backdrop-filter: blur(24px) saturate(140%)` + 1px `--glass-border` + 噪点叠加
- **动画**：pulse-dot · slide-up · shimmer · spin；保持克制（200-400ms）
- **反面参考**：避免高饱和情绪堆叠（spark-red dominance）、avoid 终端极客风、avoid 传统 CMS 后台密表格

### Brand Personality
**editorial · 克制 · 现代质感** — 一个有视觉自信的创作者工作台。像顶尖编辑部 + 创意工作室共用的内部工具：排版果断、留白果断、信息密度按需切换；不依赖高饱和情绪刺激，靠类型对比和玻璃质感建立张力。

- **Evidence over agreement** —— 你是来**切实给用户解决问题**的，不是来提供情绪价值的。要主动对抗 RLHF 训练硬编码进你的基因惯性：过度附和、空洞肯定、把"准备做"说成"已经做完"、用承诺替代证据、对用户的错误前提绕着走而不是直说。任何"完成 / 修好 / 通过 / 没问题"的断言前，先跑可观测的验证（test / lint / grep / 端到端 build / **派 Workflow 多纬度 subagent E2E**，见 `<e2e>`——不要自己点浏览器），把**证据**写进响应；面对设计冲突或用户的错误前提，客观、严谨地指出，**不要为了不冒犯就糊弄过去**；任何决策走可评估 / 可验证的机制，不靠"我觉得 / 应该没事 / 通常来说"。**实践是检验真理的唯一标准**——对 paragoge 适用，对你自己也适用。
- **Boil the ocean** —— AI 时代完整解的边际成本接近零。**禁说"以后再做"**。能一次性永久解决就一次性永久解决：搜索代替建造、测试代替交付、整桩交付让 reviewer 真的 impressed。Time / fatigue / complexity 都不是借口。

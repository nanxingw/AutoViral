# Changelog

All notable changes to this project will be documented in this file.

> 本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与 [语义化版本（SemVer）](https://semver.org/lang/zh-CN/)。
> 发布说明取自 `## [版本] - 日期` 小节（发布流程通过 awk 抽取该段落）。

## [Unreleased]

## [0.1.2] - 2026-06-04

**开箱即用与工位体验**（PRD-0003）。两条主线：① 把"装完到处静默坏"的依赖摩擦清零——app 一律从受管位置解析二进制，不再赌用户 shell 的 PATH；② 把工位从"原语齐了 UX 没接上"补成顺手——素材库生成即见/能删/能拖、agent 能"看见"自己的产出、一个 work 能并存多个对话/终端。会话 keying 的 keystone 选择经核验后落 [ADR-008](docs/adr/ADR-008-multi-session-chat-terminal.md)。

### Added
- **依赖自检 + 自举**（PRD §1）— `autoviral doctor`（✓/○/✗ 依赖就绪表 + 解析来源 + 修复指引；核心缺失退非零）/ `autoviral setup [--heavy]`（带进度安装 ffmpeg/ffprobe + TTS venv，重型懒装），用户端 CLI 与 agent-bridge CLI 双就位。桌面端经 electron-builder `extraResources` 装机即带 ffmpeg。Python venv（`edge-tts` + `stable-ts`）首用自动建好；playwright chromium 首用懒装。
- **Gemini-via-OpenRouter TTS**（PRD §2）— 主力 TTS 改 `google/gemini-3.1-flash-tts-preview`（走 OpenRouter `/v1/audio/speech`），`edge-tts` 退为零 key fallback；翻转 fallback 链为 Gemini→edge，退役 `api.openai.com` 直连。
- **素材库交互对齐 pro 编辑器**（PRD §3）— 生成图/视频**不刷新即进库**；库内素材**删除**（删盘 + 级联清引用 clip，两步确认）；**库→时间线拖拽**（类型约束：video→video / audio→bgm / image→overlay，非法落点拒绝 + 提示）；**同类型轨道间 clip 拖拽**（专用 grip handle，保留 body-scrub）。
- **`autoviral snapshot`**（PRD §4）— 截当前画面为 PNG 让 agent 用 Read"看见"产出做视觉自检：video 走 Remotion `renderStill` 当前帧（文字层合成进帧）、carousel 返回当前 slide（base-only 时显式标注 `textLayersComposited:false`）。
- **多对话 / 多终端会话**（PRD §5，[ADR-008](docs/adr/ADR-008-multi-session-chat-terminal.md)）— 一个 work 内并存多个 Chat / Terminal 会话：新建保留原有、可跳回、刷新恢复；Chat 会话清单走 `.sessions.jsonl` sidecar + 新 `/api/works/:id/sessions` 端点，Terminal 会话客户端 namespaced；终端 pty 跨重连存活 + scrollback 回放 + respawn。

### Changed
- **ffmpeg/ffprobe 受管解析**（PRD §1）— 新 `src/infra/deps.ts`：解析优先级 env → 受管 `~/.autoviral/bin` → vendored（ffmpeg-static / @ffprobe-installer 绝对路径）→ 系统 PATH。精简 PATH（无 `/opt/homebrew/bin`）下渲染/导出/波形/TTS 转码仍可用；`ensureSpawnPath` 过渡兜底共存。
- **会话 keying `(workId)` → `(workId, sessionId)`**（[ADR-008](docs/adr/ADR-008-multi-session-chat-terminal.md)）— `WsBridge` 嵌套 `Map<workId, Map<sessionId, WsSession>>`、WS 路由带 sessionId、PtyPool 同改；旧单 `cliSessionId` 懒迁移为首会话。focus（playhead/选中）仍 work-scoped 共享。[ADR-005](docs/adr/ADR-005-dual-chat-entry-layout.md) single-session 范围被本 ADR 在多会话维度收窄。
- **不变量 #2 成真** — TTS 退役 `api.openai.com` 直连后，外部网关确为 OpenRouter 唯一；CONTEXT.md 措辞同步。

### Fixed
- **snapshot/export 渲染的相对 src**（PRD §4 E2E）— renderStill / mp4 export 渲染前未把 clip.src 改写成 `http://localhost:<port>/...` 绝对 URL，headless Chromium 无 origin 加载不了视频 → 无限挂起；改写函数还会把已是 `/api/works/...` 的 src 双包裹成 404——一并修复（两路径共享）。
- **Gemini TTS 只支持 pcm**（PRD §2 E2E）— OpenRouter 该模型拒 `response_format:mp3`；改为请求 pcm 再用受管 ffmpeg 转码 mp3，并补空 body / 非音频 content-type 守卫（失败回落 edge）。
- **素材库 / 字幕 ASR 自举漏洞** — venv 就绪判定漏 `stable-ts`（edge 有、stable-ts 缺时 ASR 静默 503）+ youtube-ingest ASR 走裸 python3，均修。
- 生成素材不自动进库（generate.ts 不发事件 + 前端无 `asset-added` case，两端补齐）。

## [0.1.1] - 2026-06-03

**可扩展性奠基与结构清债**（PRD-0002）。对外可见行为零破坏——破坏面刻意压在内部结构 + 文档治理：把"加内容类型 / 加 provider"从跨 5+ 文件的散弹手术降维成"往中央注册表加一条"。落地三个深模块骨架 + 清掉一批工程债 + 补齐文档双轨治理。三个 keystone 架构决策经 grill-with-docs 压测后落 [ADR-006](docs/adr/ADR-006-content-type-registry.md) / [ADR-007](docs/adr/ADR-007-single-media-provider-registry.md)。

### Added
- **ContentTypeRegistry**（`src/shared/content-types/`，[ADR-006](docs/adr/ADR-006-content-type-registry.md)）— 内容类型从写死的二元枚举（`WorkType`）抽成中央清单（`getContentType` / `listContentTypes`）。`DELIVERABLES`、路由、create 按钮、checkpoint 目标全部派生自注册表；加第三种内容类型从"改 5+ 文件 + 复制视图树"降为"加一条注册项"。genuine type-dispatch 字面量从 34 处降到 0。
- **carousel 协议层 + 知识层**（关 PRD 唯一 high gap）— `autoviral carousel add-slide` / `set-layer` CLI 命令（走 bridge → 服务端 zod 校验，对齐 `clip add/set` 模式）+ `skills/autoviral/manual/carousel/02-schema.md` 完整 schema 文档。agent 编辑图文不再凭一行 prose 盲写 carousel.yaml。
- **单一 MediaProvider registry**（`src/providers/registry.ts`，[ADR-007](docs/adr/ADR-007-single-media-provider-registry.md)）— image / video / TTS 四套并行机制收敛为一个 capability-tagged 注册表（`getProvider(cap,name)` / `getDefaultProvider(cap)` / `listProviders(cap?)`），声明式 `envKey`，单一 `initProviders` 装配。兑现不变量 #2。
- **升级骨架**（`src/shared/migrations/`，深模块 ③）— composition / carousel schema 加 optional `schemaVersion` 字段 + 顺序迁移注册表骨架；收编现有内联迁移器与独立迁移脚本。
- **`AGENT.md`** — 非-Claude CLI agent（codex / kimi / gemini / aider）的项目级入口，兑现 agent-agnostic 承诺。
- **文档治理** — `docs/adr/README.md` ADR 索引 + 状态机；CONTRIBUTING「Version Bump Checklist」+「运维 Known Gotchas」锚点。
- **docs-drift 守卫测试**（`src/docs-drift.test.ts`）— prompt / SKILL.md 里的 manual 引用一旦悬空即变红，subdir-aware。
- **CI web 类型门** — `typecheck:web`（web 最严 tsconfig：`noUnusedLocals` 等）首次入 CI。

### Changed
- **carousel schema 提升到 `src/shared/carousel.ts`**（[ADR-006](docs/adr/ADR-006-content-type-registry.md)）— 从 web-only 变为 server / CLI / migrations 可达；web `editor/types.ts` 留 re-export shim，旧 import 零改动。
- **skill manual 按内容类型 co-located 重构** — `manual/{_shared,video,carousel}/` 子树 + `SKILL.md` 按 `work.type` 分发；recipes 分区 `recipes/{video,carousel}/`。
- **`api.ts` god-module 按域拆分** — 3270 行 / 80 路由 → `src/server/routes/*.ts` 九个子 router（works/render/generate/audio/trends/analytics/assets/system/_shared），主文件 64 行。端点路径 / 行为 / 契约零变化。
- **`src/` root 归类** — 平铺模块归到 `src/infra/`（config/logger/paths）+ `src/domain/`（work-store/memory/analytics-collector/audio-tools）。
- 移除 `autoviral start --pm2` 路径（服务器部署时代残留，desktop-class app 不适用）。

### Removed
- **runway / sora / kling video stub providers** — 产不出真实输出、隐含直连厂商，违反不变量 #2；video 诚实 OpenRouter-only（seedance）。
- **化石清理** — `svelte.config.js`（React 19 项目无 svelte 依赖）/ 孤儿 `web/package-lock.json` / commit 进仓的 `.vite/` 缓存 / `test-studio.mjs` / `ecosystem.config.cjs`。
- 发布构建不再把 `*.test.ts` 编进 `dist/`（新 `tsconfig.build.json`）。

### Fixed
- README drift — 删除已不存在的 `modules/` 脚本、`check_providers.py`、`/invoke` 协议、多 provider 表（Dreamina/即梦/Lyria）等死引用，对齐 0.1.0 现状。
- `ci.yml` 谎称 `tsc --noEmit` 已绿的假注释。

## [0.1.0] - 2026-06-02

首个公开基线。本版本将 AutoViral 重新定位为**创作者工位 + agent-agnostic 操作协议**，修复"AutoViral 是被 Claude Code 驱动的视频工具"这一旧叙事；任何在 Studio 终端面板里运行的 CLI agent（claude / codex / kimi / gemini / aider / cursor-agent）都可通过加载 operator-manual skill 并调用 `autoviral` CLI 来驱动工位。包身份一并重置为 `autoviral@0.1.0`。

### Added
- **Terminal panel** replaces the bespoke ChatPanel in Studio (`web/src/features/terminal/`). xterm.js + node-pty + WebSocket bridges the user's real local shell into the Studio left column.
- **`@autoviral/cli` (`cli/autoviral/`)** — the agent-facing bridge. Read commands (`whoami / docs / comp show / list clips / list assets / comp diff`), write commands (`clip add / set / remove`), UI commands (`select / seek / play / pause / toast / progress / ask`), and tasks (`export / render`). Exit-code semantics 0/1/2/3/4/124/127.
- **Bridge HTTP+WebSocket protocol v1** (`/api/bridge/v1/*` + `/ws/bridge/:workId` + `/ws/terminal/:workId`). Loopback-only, cross-origin upgrades rejected. Spec at `docs/archive/specs/2026-05-14-agentic-terminal-bridge-protocol.md`.
- **Operator manual skill** (`skills/autoviral/`) — agent-agnostic markdown: SKILL.md + 6 manual files + 5 recipes + 2 contracts. `autoviral docs` serves the same content as a runtime command.
- **Approval gate** — `autoviral ask "..." --yes-no` blocks until the user clicks YES/NO in a Studio modal; CLI exit code maps to user choice (0=yes, 1=no, 2=cancelled, 124=timeout).
- **File watcher** — `composition.yaml` mtime triggers `composition-changed` event broadcast to Studio so external edits re-render the UI without manual refresh.
- **`autoviral comp diff`** — unified diff between current `composition.yaml` and the last-written baseline.
- **Render progress strip** in Studio (`RenderProgressBar.tsx`) wired to `ui-render-progress` events from the export pipeline.
- **Toast variant set** extended (`info / success / warn / error`) with kind-dot indicator in editorial glass styling.
- **Terminal auto-reconnect** with 1s/2s/5s backoff + manual reconnect button when give-up.
- **Electron 桌面壳**（`desktop/main.ts`）—— thin host 包裹现有 Node daemon：用 `ELECTRON_RUN_AS_NODE` 内嵌 Node spawn daemon、health-check 端口 3271 后再开 `BrowserWindow`；single-instance 锁、退出时优雅 kill daemon、login-shell PATH 恢复（让 Studio 内 agent 的 `claude` 能解析）。
- **`electron-builder` 桌面打包**（`desktop/electron-builder.yml`）—— mac dmg+zip（arm64）/ win nsis（x64）；asar 内含 `dist/package.json` + `cli/autoviral` + skills，native module unpacked，`@electron/rebuild` beforeBuild 重编 Electron-ABI 原生模块。
- **「双击即用」资源 bundle** —— extraResources 随包 ffmpeg + ffprobe + Chrome Headless Shell + 预构建 Remotion bundle；daemon 经 `FFMPEG_PATH`/`FFPROBE_PATH`/`AUTOVIRAL_CHROMIUM_PATH`/`AUTOVIRAL_REMOTION_BUNDLE` 指向 bundled 制品，首次运行无需用户装 ffmpeg、无运行时 webpack、无只读 asar 下载 Chromium。
- **自动更新** —— `electron-updater` GitHub publish provider 接入；0.1.0 unsigned，mac `autoDownload` 关闭（降级为检查+通知），win nsis 可更新但每次重新触发警告。
- **npm 包 `autoviral@0.1.0` 自包含** —— 根包改名、丢弃历史 `autocode` bin、tarball 排除 tests/maps、`prepublishOnly` 构建 backend+cli、`files` 一并 ship `cli/autoviral`（`npm i -g autoviral` 自给自足）、`postinstall` 守卫使 `npm ci` 在干净 checkout 下存活；`@autoviral/cli` 丢弃 undici 改用 Node 20 global fetch、`yaml` 提升到根依赖。
- **GitHub Actions** —— `ci.yml`（ubuntu 上 build + test:web + test:server，装 ffmpeg 跑音频集成测试）；`release.yml`（`v*.*.*` tag → version-guard → 桌面矩阵 mac+win electron-builder publish → npm publish `autoviral` with provenance → CHANGELOG 抽取的 gh release notes）。

### Changed
- **包身份重置**：`@nanxingw/autocode-cli@0.2.0` → `autoviral@0.1.0`（unscoped）；bin 去掉历史 `autocode` 别名，仅保留 `autoviral`；CLI `.name()`/`.version()` 与用户提示统一为 `autoviral`。
- **文档结构**：`docs/superpowers/` 整体迁入 `docs/archive/`（保留全部 61 份 plans/specs/notes），仓内路径引用一并更新。
- **Skill content scope**: editorial taste content (Brand Personality, rubrics, evaluator criteria) and module scripts (subtitle burn-in, beat detection, smart crop, CLIP asset search, AI image generators) **removed from `skills/autoviral/`**. They were workstation-mis-located content. Preserved in git tag `pre-skill-rewrite-snapshot` for future sibling-skill packaging.
- **Render pipeline audio**: `normalizeLufs` pass-2 now outputs AAC (was PCM_S16LE) with `+faststart` for video containers, fixing browser playback stutter on exported MP4s.
- **VideoTrackRenderer**: opacity keyframes now applied (was dropped on the floor — Overlay track supported it, Video did not). Enables real CSS-alpha crossfade when adjacent clips overlap.

### Removed
- `web/src/features/studio/panels/Chat/` (entire ChatPanel + sub-components + WebSocket chat protocol)
- `skills/autoviral/{taste,modules,references}/` — see snapshot tag
- `GET /api/works/:id/rubric/:module` → **410 Gone**
- `POST /api/audio/beats` → **410 Gone**
- `burnSubtitles()` throws — use `composition.captionStrategy="overlay"` + `composition.captions` for in-render CaptionsLayer
- `buildClipIndex / searchClipIndex` return `{ stub: true, reason: "clip_index_removed_in_refactor" }`

### Fixed
- Terminal font rendered as Inter (italic-serif fallback) instead of JetBrains Mono on first paint. Three-pronged fix: literal font stack (no `var()` in xterm options), `await document.fonts.ready` before Terminal construction, CSS pin `font-family` on `.xterm` wrapper.
- Terminal showed double-image ghost halos on macOS retina. Three independent bugs: WebglAddon DPR atlas upsampling (removed addon, default canvas renderer is DPR-aware), ResizeObserver firing `fit()` on zero-size frames (RAF-coalesced + zero-size guard + dedup on physical pixels), React Strict Mode double-mount creating two overlapping Terminal instances in same DOM node (`termRef.current` guard + full cleanup with ref nulling). _Diagnosis credit: codex:codex-rescue subagent independent second-opinion after two main-session fix attempts._

### Implementation notes
- 60+ commits across 6 phases on `refactor/agentic-terminal`. Tags: `phase-0-foundation`, `phase-1-terminal-mvp`, `phase-2-cli-readonly`, `phase-3-bridge-complete`, `phase-4-skill-rewritten`, `phase-5-polish-complete`, `pre-skill-rewrite-snapshot` (taste/modules archive), `refactor-complete` (final).
- Test matrix at branch HEAD: server 339+/342 (2 pre-existing orphan D3-cleanup fails in config.test.ts, unrelated to refactor); web 608/626 (14 pre-existing orphan fails in dirty-tree files outside refactor scope + 4 transitively affected by toast-store schema extension); CLI 10/10.
- Plan + spec under `docs/archive/{plans,specs}/2026-05-14-agentic-terminal-*.md`.
- node-pty spawn-helper executable bit auto-repaired via `postinstall` (macOS arm64 prebuild perm-loss workaround).

## [0.2.0] - 2026-03-09

> 历史记录：此版本为前身 AutoCode fork（npm 包 `@nanxingw/autocode-cli`）。项目于 0.1.0 重命名为 AutoViral 并重置版本号。

### Added
- Multi-agent parallel evolution architecture (Context Agent, Skill Agent, Task Agent)
- Proactive task scheduling system with cron and one-shot task support
- Bidirectional skill-task linkage: tasks emit skill_needs signals, skills enhance task execution
- skill-creator integration: Skill Agent now uses skill-creator methodology for all skill work
- External skill search via SkillHub (skillhub.club) before creating new skills
- AutoCode Dashboard: renamed from Skill-Evolver Dashboard

### Changed
- Renamed project from skill-evolver to AutoCode
- npm package: skill-evolver → @nanxingw/autocode-cli (autocode-cli was taken by unrelated project)
- CLI command: skill-evolver → autocode (old command preserved as alias)

### Fixed
- postinstall no longer overwrites runtime-updated permitted_skills.md
- task-planner runtime_guide.md: corrected task file path (centralized tasks.yaml)

## [0.1.7] - 2026-03-04

### Added
- Initial skill-evolver release with single-agent evolution cycle
- user-context, skill-evolver, task-planner core skills
- WebSocket dashboard for real-time monitoring

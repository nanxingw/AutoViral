# Changelog

All notable changes to this project will be documented in this file.

> 本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与 [语义化版本（SemVer）](https://semver.org/lang/zh-CN/)。
> 发布说明取自 `## [版本] - 日期` 小节（发布流程通过 awk 抽取该段落）。

## [Unreleased]

## [0.1.3] - 2026-06-05

**把 NLE 接通给 agent**（PRD-0004）。核心命题：任意 CLI agent 经 `autoviral` CLI 驱动剪辑，与人在 UI 操作产出一致——调研坐实"意图级编辑能力是 built-but-human-only"，本版把**写路径**补齐。keystone = [ADR-009](docs/adr/ADR-009-shared-composition-ops-core.md)：意图级 mutation 单一实现放 `@shared/composition/ops`，前端 store（immer draft）与后端 bridge（parsed object）共消费同一份纯函数，永久消除前后端漂移。21 个纵切片，每片切穿 schema→@shared ops→bridge/CLI→UI→test 端到端可验证；命题核心经两轮多纬度浏览器 E2E（agent-CLI 驱动 vs 人-UI 各纬度，截图 + DOM/computed-style 二确）证明。

### Added
- **意图级动词，CLI / bridge / store 共用同一份 @shared op**（[ADR-009](docs/adr/ADR-009-shared-composition-ops-core.md)）— `clip split`（指定时刻切两段 + keyframe 重基）/ `clip trim`（邻接 cap clamp + 最小时长）/ `clip set --track-id`（跨同 kind 轨移动 + 源轨孤儿 transition prune）/ `clip keyframe add/set`（opacity·scale·position 等可 keyframe，crossfade·Ken Burns 不再必败）/ `transition add/remove`（preset 来自共享 registry，afterClipId 非末位约束）/ `track add/remove` + `clip add --track-id` 精确定位 + overlay 片段真支持。前端 store 切到调 ops，现有 store 测试零断言改写即绿（零行为变化安全网）。
- **整份回写 + 写前预检** — `comp put <file|-stdin>`（万能逃生口，经 chokepoint zod 校验原子回写）/ `comp validate`（`@shared/composition/preflight` 纯校验返回 `{ok,errors,warnings}` 不落盘）/ 写端点 `--dry-run`（写 chokepoint 一处实现，跑 mutator + 校验但不落盘不广播），砍掉 agent "PUT→400→读 zod dump→猜" 的昂贵循环。
- **ASR 字幕接通最后一公里** — `captions generate [--language]` 调已有 ASR 把带时间码 segments 写进 text track（**无 text 轨自动建轨**）；Studio 加"生成字幕"按钮触发同流程；改完即刷新。
- **基础画面操作** — fit-fill 填充模式（cover / contain-letterbox / blur-bg）/ crop + 翻转镜像（`crop{x,y,w,h}` + `flipH/flipV`，Remotion preview + ffmpeg export **双消费**）/ 倒放（ffmpeg 真倒放 + preview 明示"仅导出生效"占位，不造假 WYSIWYG）+ 定格（`freezeAtSec` preview+export 双生效）/ 画布比例一键切换（9:16 ↔ 1:1 ↔ 16:9 ↔ 4:5，按比例适配既有 clip 的 static + keyframe 偏移）。所有新字段均有渲染器/ffmpeg 消费断言（防死字段）。
- **编辑安全网** — clip 级 undo + Cmd/Ctrl+Z（覆盖 split/trim/move/set/delete/ripple-delete/collapse-gaps）/ agent 可达 `checkpoint list` · `checkpoint restore`（**restore 前自动快照当前态防丢数据**，可逆）。
- **写路径改完即刷新** — 写 chokepoint `mutateCompositionFor`/`mutateCarouselFor` 成功落盘后经注入式 `onCommitted` 回调广播 `composition-changed`/`carousel-changed`，前端无需 reload 即反映（composition-ops 不耦合 event bus）；**carousel Editor 页接上 bridge 订阅**（此前结构性未接通）。`fs.watch` 降为兜底。

### Changed
- **错误码契约两端打通** — 所有 4xx 校验错带 `code:4`，`client.ts` 按退出码分支：4xx→exit 4 / 5xx→exit 3 / `ask` timeout→124，agent 可据退出码做控制流。CLI 集成测试接入标准 gate。
- **平台 preset 真生效** — 尺寸 / 响度 LUFS / 码率下沉 `@shared` 单一事实源（前端 `PlatformPresetSection` 与 `runRenderPipeline` 读同一份）；`/export` 的 `preset` 真被应用，未知 preset → 400。
- **`carousel set-layer` 改为 PATCH** — deep-merge：只覆盖显式给的字段、保留其余 box/style，对齐 `clip set` 的 patch 语义（此前是 REPLACE，agent 改一字段会清掉全部样式）；新增 `--italic`/`--tracking` flag。
- **`whoami` 报告真实包版本**（此前硬编码 `BRIDGE_VERSION="0.1.0"`，改为读 package version 单一事实源）。

### Fixed
- **止谎** — 清掉文档/manual/recipe/CLI help 里照做必败的假承诺（必报 400 的 `clip set --keyframes`、运行时 throw 的 overlay 能力、指向已删脚本/不存在 UI 的假注释）；变量变速 export 静默回 1× 时发 warn；crossfade recipe 回填为真能跑通的 `transition add` 路径。
- **`clip set` 拒绝静默 strip** — `@shared/composition/patch` deep-merge + per-kind 白名单，解析嵌套路径（`transforms.scale` / `filters.brightness` / `style.color` / `fade.in` / `ducking.ratio` 等），未知/拼错 key 返 400 而非 zod 静默吞；CLI 按字段期望类型解析（`--color 000000` 不再被强转成数字 0）。
- **`captions generate` 默认路径对真实作品 400**（浏览器 E2E 实证）— 真实 composition 的音频 src 存为 served-URL 形 `/api/works/<id>/assets/...`，resolve 时被 path-traversal 守卫误杀；resolve 前剥前缀（门控在该前缀上，恶意 `../` / 绝对路径仍拒）。同步加固 captions 音频路径 path-traversal（resolve + 前缀校验）。
- **意图 op 写路径硬伤**（各片对抗复审 + E2E 加固）— `splitClip` 浅拷贝致两段 clip 共享嵌套对象引用（agent split 后 patch 一段会污染另一段）→ 双宿主安全的 read-through cloneDeep；ripple-delete / collapse-gaps 漏进 undo 栈（数据丢失）；`transition` durationSec / `keyframe` atSec / `freezeAtSec` 时长越界未拒；`CompositionOpError` 经 store toast surface 而非静默 no-op。

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

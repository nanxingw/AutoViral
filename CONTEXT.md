# AutoViral · Project Context

> Domain glossary + invariants. Read this before any non-trivial work to keep terminology consistent across skills, agents, and reviewers. Refresh when you find yourself inventing a new term or contradicting an entry below.

## What AutoViral is

A creator workstation for short-form video / image / poster content. Single-user desktop-class web app (React + Vite + Express) with a built-in agent terminal — the user is creating, an agent is collaborating, AutoViral provides the interactive shell.

**Positioning (decided 2026-05-15, see [ADR-001](docs/adr/ADR-001-autoviral-owns-the-editing-layer.md))**: AutoViral does the editing layer *itself* (it is not a protocol that delegates editing to hyperframes). External sibling skills exist for **taste / craft** (`editorial-pro`, etc — *what* to make) and **engineering / process** (`mattpocock/*` — *how* to collaborate). hyperframes is referenced for technique only, not bundled.

## Domain glossary

### Workspace primitives

| Term | Meaning |
|---|---|
| **work** | A single creator project. Lives at `~/.autoviral/works/<workId>/`. Each work has exactly one **content type**, which decides its deliverable file + editor route. |
| **workId** | Stable identifier of the form `w_<YYYYMMDD>_<HHMM>_<short-rand>` (e.g. `w_20260513_1919_74d`). Used as both directory name and route segment. |
| **content type** | The kind of creation a work produces. Two today: `short-video` (deliverable `composition.yaml`, edited in Studio at `/studio/<workId>`) and `image-text` (deliverable `carousel.yaml`, edited in Editor at `/editor/<workId>`). Declared in a central registry (`src/shared/content-types/`) rather than scattered string branches. *See [ADR-006](docs/adr/ADR-006-content-type-registry.md).* |
| **composition.yaml** | The `short-video` work's canonical data file. Zod-validated (`src/shared/composition.ts`). Holds tracks, clips, captions, export presets, and (after the variables PRD lands) a `variables` declaration block. |
| **carousel.yaml** | The `image-text` work's canonical data file — the carousel counterpart of composition.yaml. Zod-validated (`src/shared/carousel.ts` after ADR-006). Holds slides, each with a background + layers (text / image / shape / sticker discriminated union) + globals. |
| **assets/** | Per-work directory of media files: `assets/clips/*.mp4`, `assets/audio/*.mp3`, `assets/images/*.png`, `assets/subtitles/*.srt`. |
| **plan/** | Per-work directory of agent-produced intermediate artifacts (transcripts, segment JSON, brief markdown). Not user-facing. |

### Composition vocabulary

| Term | Meaning |
|---|---|
| **track** | A named horizontal lane in the timeline. Kinds: `video` / `audio` / `text` / `overlay`. Same-kind tracks can coexist (e.g. `trk_video_main` + `trk_video_broll`). |
| **clip** | A unit placed on a track. References an asset (for video/audio) or carries inline content (for text). Has `inSec` / `outSec` (source time) + `trackOffset` (timeline time). |
| **CaptionModel** | The structured caption data on a composition. Two halves: immutable per-word `segments` (from ASR) + visual `groups` that decide how segments are grouped into on-screen lines. Has style + animation per group. |
| **captionStrategy** | Either `overlay` (newer; React `<CaptionsLayer>` renders from CaptionModel) or `burn` (legacy; libass-baked into the video track). Default is `overlay`. |
| **highlight.type** | After H3 lands: enum of caption highlight animations — `basic-color` (default) / `marker-sweep` / `scribble` / `burst` / `slam` / `elastic` / `clip-reveal`. |
| **variables** | After H2 lands: top-level declaration block on composition.yaml; defines typed parameters (`string` / `number` / `color` / `boolean` / `enum`) with defaults. References anywhere in the composition via `${id}` interpolation. Override at render time with `--variables` flag. |
| **exportPreset** | Named platform target (`douyin` / `bilibili` / `youtube-shorts`) defining aspect ratio, FPS, max duration, codec. |

### UI surfaces

| Term | Meaning |
|---|---|
| **Studio** | The main editing view at `/studio/<workId>`. Three regions: left sidebar (works/assets/inspector), center preview (Remotion Player + timeline), **right pane** (Tweaks above, agent surface below). |
| **Right pane · agent surface** | After M lands: a horizontal-tabbed container hosting two agent entry points — **Chat** (default, low cognitive load, `claude -p` subprocess) and **Terminal** (xterm.js + any CLI agent). Tab state persists per-work via `localStorage`. Both surfaces stay mounted across switches so long sessions don't reset. *See [ADR-005](docs/adr/ADR-005-dual-chat-entry-layout.md).* |
| **Chat panel** | The non-technical-user-facing agent surface. Streaming markdown chat (pneuma-inspired), `<viewer-context>` envelope auto-prepends user focus state, `<viewer-action/>` tag from agent drives Studio (seek/select/scroll), checkpoint rollback for safety. Backend: spawns `claude -p` subprocess per chat session. |
| **Terminal panel** | The power-user-facing agent surface. xterm.js pane hosting an arbitrary CLI agent (Claude Code / Codex / Kimi / Gemini / Aider). Injected env vars: `AUTOVIRAL_WORK_ID`, `AUTOVIRAL_PORT`, `AUTOVIRAL_CWD`. Receives focus via dim `[ctx: ...]` prefix line above the input. |
| **bridge** | The WS + HTTP protocol between Studio frontend and AutoViral backend. Used by both the React UI and the `autoviral` CLI. Surface: `/bridge/*` endpoints + WebSocket event bus. |
| **focus** | The union of UI selection state — a single source-of-truth state object that agents can read via `autoviral context`. Both Chat and Terminal surfaces consume the same focus channel — Chat via `<viewer-context>` envelope, Terminal via dim prefix line. Schema (zod-validated on the bridge): `{ selectedClipId: string \| null, playheadSec: number, selectedSegmentId: string \| null, activePanel: "timeline" \| "inspector" \| "preview" \| "sidebar" \| null }`. All fields are optional in the patch payload so the store can grow without breaking older clients. Playhead writes are throttled to 10 Hz client-side to keep the bridge from saturating on scrub. |
| **context channel** | After H0 lands: agent-facing aggregator that emits work + focus + composition + trends + profile as a single JSON snapshot. CLI: `autoviral context [--watch]`. |

### Pipeline vocabulary

| Term | Meaning |
|---|---|
| **ingest** | The pipeline that pulls external media into a work. YouTube → yt-dlp → Whisper transcribe → OpenRouter translate → CaptionModel bootstrap → composition.yaml seed. CLI: `autoviral ingest youtube <url>`. |
| **preprocess** | Asset-level transformations done before clip placement. After H4 lands: includes `preprocess tts` (text-to-narration audio). |
| **render pipeline** | Server-side composition → mp4 path. Driven by `src/server/render-pipeline.ts` via Remotion. Triggered by `autoviral export [--preset]` or `autoviral render` (alias `--proxy`). |
| **quality gate** | After H1 lands: the four-in-one composition introspection — `lint` (schema + semantic) / `inspect` (text overflow + out-of-canvas) / `validate` (WCAG contrast) / `animation-map` (tween Gantt + dead zones). CLI: `autoviral check`. |

### Provider vocabulary

| Term | Meaning |
|---|---|
| **OpenRouter** | The sole external gateway since `c1c374e` (2026-05-12). Used for image gen (`openai/gpt-5.4-image-2` aka NanoBanana), video gen (`bytedance/seedance-2.0`), translation (`anthropic/claude-sonnet-4.5`). API key from `.env` `OPENROUTER_API_KEY`. |
| **NanoBanana** | The product name for OpenRouter's `openai/gpt-5.4-image-2` image generation. ~$0.04/image. |
| **Seedance** | OpenRouter's `bytedance/seedance-2.0` i2v video generation. ~$0.76/3s. **Gotcha**: durationSec only accepts {3, 5, 10}; output is fixed 720x1280@24 regardless of input aspect (see memory `reference_seedance_i2v_durations.md`). |
| **Whisper / stable-ts** | Local audio transcription. `pip install stable-ts` (not `stable-whisper`); module imports as `stable_whisper`. Word-level timestamps via `word_timestamps=True`. |

### Inspiration & Analytics vocabulary (v0.1.5, [PRD-0006](docs/prd/0006-v0.1.5-inspiration-data-redesign.md))

| Term | Meaning |
|---|---|
| **creator analytics** | The 数据 (Analytics) page's data: the creator's own per-post metrics (play/digg/comment/share/collect) + lifetime averages, derived purely from the on-disk Douyin snapshot. Client adapter `web/src/queries/analytics.ts`; pure derivation core `web/src/lib/creator-analytics.ts` ("D1"). NOT audience demographics — those are unobtainable (see invariant 8 + [ADR-011](docs/adr/ADR-011-douyin-collector-managed-venv-scrape.md)). |
| **coach** | The grounded research/strategy chat agent on the 灵感 (Explore) page — a **second, persisted agent persona** distinct from the Studio editing agent. Reads the creator's works + selected-platform trends + interests; streams scored 选题 + `<coach-idea>` tags. Workless session keyed `coach_main`, sidecar-persisted, **session-scoped model**. *See [ADR-010](docs/adr/ADR-010-grounded-coach-persona.md).* |
| **angle brief** | A small push-feed of concrete personalized 选题 on Explore, replacing the old hard-coded "起手切角" card. Pure deterministic shaper `src/domain/angle-briefs.ts` over the same {works, trends, interests} context the coach reads — no LLM on page load, no fabrication. Each carries a `grounding` chip (`trend+interest` / `trend` / `interest` / `thin`). Served by `GET /api/coach/angle-briefs/:platform`. |
| **benchmark band** | The per-KPI diagnostic band on 数据 that positions a metric against a same-follower-tier cohort ("互动率 2.6% 低于 nano 层中位数，目标区间 X–Y"). Static in-repo JSON + pure positioning fn ("D2", `web/src/lib/benchmark.ts`). Must be platform-correct for the shown platform **or** explicitly labeled 参考性. |
| **platform-honesty matrix** | The 数据 table stating, per platform, {能否自有数据 / 受众画像+门槛 / 趋势来源 real-vs-LLM}. The honest replacement for the deleted demographics cards. |
| **insight guardrail** | Pure filter ("D3", `src/domain/insight-guardrail.ts`) that rejects any agent-generated 洞察 citing a metric NOT actually on disk (e.g. retention/完播率). Encodes honesty as a tested gate, not a review habit. |
| **trend provenance** | The honesty label on each trend row: `实采` (real scrape) vs `Agent 推理` (`source: agent_websearch`, LLM-invented, `metrics: null`). Today only xiaohongshu truly scrapes (Playwright, titles+covers, no engagement numbers); youtube/tiktok/douyin route to `agentFallback`. |
| **collector** | The Douyin creator-data scraper: `f2` + `browser_cookie3` running in the managed venv at `~/.autoviral/collector-venv`, reading the user's logged-in douyin.com `sessionid` cookie. `POST /api/analytics/refresh` → honest 401 + re-login prompt when no session. *See [ADR-011](docs/adr/ADR-011-douyin-collector-managed-venv-scrape.md).* |

### Script & storyboard vocabulary (v0.1.6, [PRD-0007](docs/prd/0007-v0.1.6-script-storyboard-planning.md))

The **planning layer** that sits BEFORE generation: write/let-an-agent-draft a 剧本, see it decomposed into 分镜, edit each shot, then hand a shot off to generation.

| Term | Meaning |
|---|---|
| **剧本 (script)** | The free-text narrative outline — the work's "PRD". Plain markdown at `plan/script.md`, read/written/watched via `GET|PUT /api/works/:id/plan/script.md` (raw `text/markdown`, NOT the bridge envelope; empty body = unwritten plan, never a template — #73/#83 i18n-as-data rule). Editor: `web/.../AssetSidebar/ScriptTab.tsx` (`useScript` store). The 剧本 and 分镜 are **two independent surfaces** weakly linked by `scene.mdAnchor` — the UI shows an honest drift notice, neither implies the other. |
| **分镜 (storyboard)** | The ordered list of shots — the work's "issues". `composition.scenes[]` (schema `SceneSchema` in `src/shared/composition.ts`), rendered as a sortable card list. |
| **场 / 镜头 (scene / shot)** | One `Scene` = one shot. Fields: `title` (required) · `order` (owned by the ops, contiguous 0..N-1) · `intent` · `prompt` (画面描述) · `narration` (旁白) · `durationSec` · `shotSize` (景别) · `cameraMovement` (运镜) · `mdAnchor` · plus the generation-handoff state `generatedAssetIds` / `selectedAssetId` / `status`. |
| **景别 (shotSize)** | The framing enum: `long` / `full` / `medium` / `close` / `closeup`. |
| **运镜 (cameraMovement)** | The camera-move enum: `push` / `pull` / `pan` / `track` / `follow` / `static`. |
| **intent** | The beat's narrative role: `hook` / `build` / `payoff` / `cta`. |
| **scene status** | `planned` (待生成, hollow dot) → `generated` (已生成, filled dot + thumbnail) → `stale` (需重生, when a generation-affecting field changes after generation). |
| **生成 handoff (generation handoff)** | 「生成此幕」takes the shot's own fields (prompt enriched with 景别/运镜/旁白) and hands them to the EXISTING generation flow — the planning layer owns NO generation engine. `POST /api/bridge/v1/scene/:id/generate` generates one image, registers it as an `AssetEntry` in `composition.assets`, and `linkSceneAssets` writes it back — register + link commit in ONE locked mutator so `generatedAssetIds` can never reference an absent asset (no dangling ref). 「重拍」re-runs it (appends a take). *See [ADR-012](docs/adr/ADR-012-scenes-as-plan-layer.md).* |
| **scene ops** | The intent-level scene mutations (`addScene` / `setSceneProps` / `reorderScenes` / `linkSceneAssets` / `removeScene`) in `src/shared/composition/ops/scene.ts` — the SINGLE implementation the store, the bridge routes, and the `autoviral scene …` CLI all consume (the ADR-009 shared-ops pattern extended to scenes). |

## Architectural invariants

These are constraints that should not be silently violated. If breaking one becomes attractive, escalate via an ADR.

1. **Remotion is the renderer.** No HTML / GSAP / WebGL composition language. Studio's composition rendering goes through React + Remotion components in `web/src/features/studio/composition/`. *Rationale: [ADR-002](docs/adr/ADR-002-renderer-stays-remotion.md).*

2. **OpenRouter is the only external gateway.** Provider plugins live in `src/providers/<name>/` and register via the single capability-tagged `src/providers/registry.ts` — image, video, and TTS all through one registry, one `MediaProvider` contract, one `envKey` convention. No direct vendor calls: the runway/sora/kling video stubs are dropped (video is OpenRouter-only via seedance), and **TTS now genuinely routes through OpenRouter** — the primary provider is `gemini` (`google/gemini-3.1-flash-tts-preview` via OpenRouter's OpenAI-compatible `/v1/audio/speech`, `OPENROUTER_API_KEY`), with the free zero-key local `edge-tts` binary as the automatic fallback. The legacy `api.openai.com` direct TTS path is retired (it had a key-fallback bug: no `OPENAI_API_KEY` fell back to `OPENROUTER_API_KEY` but kept hitting OpenAI, which rejected it). *Rationale: c1c374e commit message + uniform secret management; consolidation decided in [ADR-007](docs/adr/ADR-007-single-media-provider-registry.md), lands in v0.1.1 (W5); TTS gateway alignment in [PRD-0003](docs/prd/0003-v0.1.2-zero-friction-setup.md) §2 (v0.1.2).*

3. **The deliverable yaml is the SSoT for a work.** `composition.yaml` (schema `src/shared/composition.ts`) for `short-video`; `carousel.yaml` (schema `src/shared/carousel.ts` after [ADR-006](docs/adr/ADR-006-content-type-registry.md)) for `image-text`. All mutations go through zod validation + atomic write (tmpfile + rename). No agent should bypass and write the file directly without revalidation — this is why carousel gets server-side CLI commands (W6) instead of blind yaml writes.

4. **Terminal-panel agents are skill-agnostic.** Any CLI agent (Claude / Codex / Kimi / Gemini / Aider) should drive AutoViral identically via the `autoviral` CLI + bridge. No agent-specific paths in the CLI or backend. The project-level entry for non-Claude agents is [`AGENT.md`](AGENT.md) — it is **CLAUDE.md's same-role backend counterpart**: a thin pointer to the shared `CLAUDE.md` / `CONTEXT.md` rules plus the backend-specific deltas (build/test commands, the Terminal-vs-Chat surface split, the OpenRouter-only gateway). Note the scope of this invariant: it constrains the **Terminal** surface only. The **Chat** panel currently spawns `claude -p` and is claude-code-only today — an acknowledged gap, intended-default per [ADR-005](docs/adr/ADR-005-dual-chat-entry-layout.md), with multi-backend Chat deferred to 0.2.0.

5. **`skills/autoviral/` is workstation-operations only.** Taste, editorial knowledge, and visual style libraries belong in sibling skills, not here. The AutoViral skill teaches *how to operate the tool*. *Rationale: 2026-05-14 agentic-terminal refactor, [ADR-003](docs/adr/ADR-003-sibling-skill-split.md).*

6. **E2E success = browser screenshot, not backend artifact.** See [`.claude/rules/e2e-testing.md`](.claude/rules/e2e-testing.md). Hard rules 1-5 are non-negotiable.

7. **Vitest worker pools are capped (`maxThreads: 2`, `maxForks: 2`).** Don't lift. Don't run two test sessions concurrently. See `CLAUDE.md` `<testing>` section.

8. **Honesty over a full-looking UI.** Never fabricate data, never promise data the tool cannot obtain. Audience demographics are owner-OAuth-only and unobtainable for the user's platforms at their scale — so the cards were *deleted*, not stubbed with "等待后台采集". Sparse / stale / LLM-inferred data must be labeled as such: benchmark bands flagged 参考性 when not platform-correct; trend rows labeled `实采` vs `Agent 推理`; agent insights pass the **insight guardrail** (D3) that rejects any metric not actually on disk. This is encoded as *tested guardrails* (D2/D3), not a review habit. *Rationale: [PRD-0006](docs/prd/0006-v0.1.5-inspiration-data-redesign.md); [ADR-011](docs/adr/ADR-011-douyin-collector-managed-venv-scrape.md).*

9. **Tests must not write the real `~/.autoviral`.** Routes that resolve their data dir from `os.homedir()` (trends, covers) are NOT isolated by `withTempDataDir` (which only overrides `AUTOVIRAL_DATA_DIR`). Setting `process.env.HOME` is fragile (cached `homedir()`). Isolate by mocking the module: `vi.mock("node:os", … homedir: () => fakeHome)` (not `vi.spyOn` — ESM named exports are non-configurable getters). *Rationale: 2026-06-08 — test fixtures had clobbered the user's real Douyin trends with placeholder data; see `memory/project_test_pollutes_real_home_trends.md`.*

10. **Planning and execution are decoupled.** The planning layer (剧本 + 分镜) NEVER embeds a generation cockpit and never owns an async render/generation queue. 「生成此幕」is a **handoff**: it hands a shot's fields to the existing generation flow, registers the product into `composition.assets`, and links it back to the scene — that's the whole contract. Generated assets fill `scene.generatedAssetIds` / `selectedAssetId` only; they are **NOT** auto-placed on the timeline (the card has no "上时间线" button — the planning layer and the timeline stay decoupled so generation can't clobber an already-fine-cut edit). *Rationale: [PRD-0007](docs/prd/0007-v0.1.6-script-storyboard-planning.md) §5; [ADR-012](docs/adr/ADR-012-scenes-as-plan-layer.md).*

11. **Every composition write goes through the per-work write lock.** All read-modify-write paths for a work's `composition.yaml` funnel through `mutateCompositionFor` (`src/server/bridge/composition-ops.ts`), which serializes the entire critical section per work via `withWorkLock` — concurrent writes for the same work read the previous write's committed state, not a stale shared baseline (lost-update fix). Different works run in parallel (separate queues). The full-composition `PUT /comp` and `POST /restore` also enter the lock (via an identity mutator). The slow part of a generation handoff (the provider call) happens OUTSIDE the lock; only the register+link mutation is inside it. *Rationale: [PRD-0007](docs/prd/0007-v0.1.6-script-storyboard-planning.md) S6; [ADR-012](docs/adr/ADR-012-scenes-as-plan-layer.md).*

## Code map (high-level)

```
src/                        # Backend (Node + TypeScript)
├── infra/                  # Cross-cutting plumbing (no domain logic)
│   ├── config.ts           # ~/.autoviral config load/save + dataDir
│   ├── logger.ts           # structured log sources + readLogs
│   └── paths.ts            # PACKAGE_ROOT and friends
├── domain/                 # Core domain logic (work + media primitives)
│   ├── work-store.ts       # persistent work (content) CRUD + assets
│   ├── memory.ts           # EverMemOS MemoryClient
│   ├── analytics-collector.ts  # creator-data scrape + cron
│   └── audio-tools.ts      # ffmpeg mix / loudnorm / subtitle burn
├── server/                 # Express + WS bridge
│   ├── api.ts              # REST endpoints (config / works / assets)
│   ├── bridge/             # /bridge/* — terminal-facing protocol
│   │   ├── routes.ts       # endpoint dispatch
│   │   └── ingest-youtube.ts  # YouTube → composition pipeline
│   └── render-pipeline.ts  # Remotion-driven export
├── providers/              # single capability-tagged registry (ADR-007): registry.ts + video/ (seedance) + tts/ (gemini-via-openrouter → edge-tts fallback) + nanobanana image
├── shared/                 # composition.ts (zod schema), shared types
├── trends/sources/         # Multi-platform trend scrapers
├── ws-bridge.ts            # chat-agent WS bridge (infra/domain grouping deferred — PRD Open Q)
└── postinstall.ts          # First-run setup (copies skills/, installs skill-creator, repairs node-pty perms)

web/                        # Frontend (React + Vite + CSS modules)
├── src/features/
│   ├── studio/             # Main editing view (preview, timeline, panels)
│   ├── terminal/           # xterm.js panel hosting CLI agent
│   ├── works/              # Works list + creation
│   ├── analytics/          # 数据 page: per-work table + benchmark band + honest empty states + platform-honesty matrix (pure cores in web/src/lib: creator-analytics/benchmark)
│   └── explore/            # 灵感 page: grounded coach (ADR-010) + angle briefs + trend drill-down/provenance
└── src/stores/             # Zustand-style client state (toast.ts is the canonical pattern)

cli/autoviral/              # `autoviral` CLI (Node, distributed standalone)
└── src/commands/           # whoami / docs / clip / list / ingest / export / select / seek / ask / ...

skills/autoviral/           # The operator manual (agent-agnostic markdown)
├── SKILL.md                # Entry: you're inside the AutoViral terminal
├── manual/                 # Numbered reading order
└── recipes/                # Common task patterns

docs/                       # Long-form project docs
├── archive/plans/          # Phased implementation plans (incl. the active PRD)
├── adr/                    # Architecture Decision Records (created 2026-05-15)
└── agents/                 # mattpocock skill config (created 2026-05-15)
```

## Glossary updates

- **2026-05-14** · agentic-terminal refactor — skill stripped of taste content. See `docs/archive/plans/2026-05-14-agentic-terminal-refactor.md`.
- **2026-05-15** · PRD lock — AutoViral owns editing; sibling skills split into taste + engineering. See `docs/archive/plans/2026-05-15-autoviral-absorb-hyperframes-tech.md`.
- **2026-05-15** · Adopted mattpocock skills (`to-prd` / `to-issues` / `triage` / `diagnose` / `tdd` / `handoff` / `caveman` / `prototype` / `zoom-out` / `grill-me` / `improve-codebase-architecture` / `write-a-skill` / `find-skills`) as the engineering-process skill family. Replaces superpowers:* in this project. See `memory/feedback_use_mattpocock_not_superpowers.md`.
- **2026-06-03** · I12 (PRD-0002 W7) — grouped flat `src/*.ts` into responsibility dirs: `src/infra/` (config/logger/paths) + `src/domain/` (work-store/memory/analytics-collector/audio-tools). Pure `git mv` + import rewrite; agent bridge files (`ws-bridge.ts`) left at `src/` root per PRD Open Question.
- **2026-06-03** · I03 (PRD-0002 W2) — added [`AGENT.md`](AGENT.md) as CLAUDE.md's same-role backend counterpart for non-Claude CLI agents (thin pointer + backend deltas); de-drifted README to 0.1.0 reality (provider table collapsed to OpenRouter-only, dead `check_providers.py` / `modules/` paths removed, architecture re-described as bridge HTTP/WS + `autoviral` CLI instead of the stale `/invoke` protocol).
- **2026-05-17** · Right-pane dual-surface decision — Chat (`claude -p` subprocess) coexists with Terminal (xterm.js) as horizontal-tabbed siblings. Default surface: Chat. Both consume the same focus channel from H0. See [ADR-005](docs/adr/ADR-005-dual-chat-entry-layout.md). Resolves M.1 ([Issue #6](https://github.com/nanxingw/AutoViral/issues/6)).
- **2026-06-09** · v0.1.6 ([PRD-0007](docs/prd/0007-v0.1.6-script-storyboard-planning.md)) — 剧本·分镜规划层. Added the **Script & storyboard vocabulary** (剧本/分镜/场·镜头/景别/运镜/intent/scene status/生成 handoff/scene ops) + **invariant 10** (planning/execution decoupled) + **invariant 11** (per-work composition write lock). New decision: [ADR-012](docs/adr/ADR-012-scenes-as-plan-layer.md) (scenes as the plan layer between 剧本 and generation, shared scene ops, per-work write lock, generation-as-handoff with no dangling reference).
- **2026-06-08** · v0.1.5 ([PRD-0006](docs/prd/0006-v0.1.5-inspiration-data-redesign.md), SHIPPED) — 灵感+数据 redesign. Added the **Inspiration & Analytics vocabulary** (creator analytics / coach / angle brief / benchmark band / platform-honesty matrix / insight guardrail / trend provenance / collector) + **invariant 8** (honesty over a full-looking UI) + **invariant 9** (tests must not write real `~/.autoviral`). New decisions: [ADR-010](docs/adr/ADR-010-grounded-coach-persona.md) (grounded coach as a 2nd persisted agent persona) · [ADR-011](docs/adr/ADR-011-douyin-collector-managed-venv-scrape.md) (Douyin collector via managed-venv browser-cookie scrape; demographics deleted-not-deferred; local-first secrets accepted-risk). Also cleared the 0005 9-bug backlog and de-hardcoded the Settings model-version label.

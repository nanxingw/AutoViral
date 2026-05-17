# AutoViral · Project Context

> Domain glossary + invariants. Read this before any non-trivial work to keep terminology consistent across skills, agents, and reviewers. Refresh when you find yourself inventing a new term or contradicting an entry below.

## What AutoViral is

A creator workstation for short-form video / image / poster content. Single-user desktop-class web app (React + Vite + Express) with a built-in agent terminal — the user is creating, an agent is collaborating, AutoViral provides the interactive shell.

**Positioning (decided 2026-05-15, see [ADR-001](docs/adr/ADR-001-autoviral-owns-the-editing-layer.md))**: AutoViral does the editing layer *itself* (it is not a protocol that delegates editing to hyperframes). External sibling skills exist for **taste / craft** (`editorial-pro`, etc — *what* to make) and **engineering / process** (`mattpocock/*` — *how* to collaborate). hyperframes is referenced for technique only, not bundled.

## Domain glossary

### Workspace primitives

| Term | Meaning |
|---|---|
| **work** | A single creator project. Lives at `~/.autoviral/works/<workId>/`. Has a 1:1 relationship with a `composition.yaml`. The Studio URL is `/studio/<workId>`. |
| **workId** | Stable identifier of the form `w_<YYYYMMDD>_<HHMM>_<short-rand>` (e.g. `w_20260513_1919_74d`). Used as both directory name and route segment. |
| **composition.yaml** | The work's canonical data file. Zod-validated. Holds tracks, clips, captions, export presets, and (after the variables PRD lands) a `variables` declaration block. |
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

## Architectural invariants

These are constraints that should not be silently violated. If breaking one becomes attractive, escalate via an ADR.

1. **Remotion is the renderer.** No HTML / GSAP / WebGL composition language. Studio's composition rendering goes through React + Remotion components in `web/src/features/studio/composition/`. *Rationale: [ADR-002](docs/adr/ADR-002-renderer-stays-remotion.md).*

2. **OpenRouter is the only external gateway.** Provider plugins live in `src/providers/<name>/` and register via `src/providers/registry.ts`. No direct vendor calls. *Rationale: c1c374e commit message + uniform secret management.*

3. **composition.yaml is the SSoT for a work.** Schema in `src/shared/composition.ts`. All mutations go through zod validation + atomic write (tmpfile + rename). No agent should bypass and write the file directly without revalidation.

4. **Terminal-panel agents are skill-agnostic.** Any CLI agent (Claude / Codex / Kimi / Gemini / Aider) should drive AutoViral identically via the `autoviral` CLI + bridge. No agent-specific paths in the CLI or backend.

5. **`skills/autoviral/` is workstation-operations only.** Taste, editorial knowledge, and visual style libraries belong in sibling skills, not here. The AutoViral skill teaches *how to operate the tool*. *Rationale: 2026-05-14 agentic-terminal refactor, [ADR-003](docs/adr/ADR-003-sibling-skill-split.md).*

6. **E2E success = browser screenshot, not backend artifact.** See [`.claude/rules/e2e-testing.md`](.claude/rules/e2e-testing.md). Hard rules 1-5 are non-negotiable.

7. **Vitest worker pools are capped (`maxThreads: 2`, `maxForks: 2`).** Don't lift. Don't run two test sessions concurrently. See `CLAUDE.md` `<testing>` section.

## Code map (high-level)

```
src/                        # Backend (Node + TypeScript)
├── server/                 # Express + WS bridge
│   ├── api.ts              # REST endpoints (config / works / assets)
│   ├── bridge/             # /bridge/* — terminal-facing protocol
│   │   ├── routes.ts       # endpoint dispatch
│   │   └── ingest-youtube.ts  # YouTube → composition pipeline
│   └── render-pipeline.ts  # Remotion-driven export
├── providers/              # OpenRouter-backed image/video adapters
├── shared/                 # composition.ts (zod schema), shared types
├── trends/sources/         # Multi-platform trend scrapers
└── postinstall.ts          # First-run setup (copies skills/, installs skill-creator, repairs node-pty perms)

web/                        # Frontend (React + Vite + CSS modules)
├── src/features/
│   ├── studio/             # Main editing view (preview, timeline, panels)
│   ├── terminal/           # xterm.js panel hosting CLI agent
│   ├── works/              # Works list + creation
│   ├── analytics/          # Creator profile dashboard
│   └── explore/            # Trends panel
└── src/stores/             # Zustand-style client state (toast.ts is the canonical pattern)

cli/autoviral/              # `autoviral` CLI (Node, distributed standalone)
└── src/commands/           # whoami / docs / clip / list / ingest / export / select / seek / ask / ...

skills/autoviral/           # The operator manual (agent-agnostic markdown)
├── SKILL.md                # Entry: you're inside the AutoViral terminal
├── manual/                 # Numbered reading order
└── recipes/                # Common task patterns

docs/                       # Long-form project docs
├── superpowers/plans/      # Phased implementation plans (incl. the active PRD)
├── adr/                    # Architecture Decision Records (created 2026-05-15)
└── agents/                 # mattpocock skill config (created 2026-05-15)
```

## Glossary updates

- **2026-05-14** · agentic-terminal refactor — skill stripped of taste content. See `docs/superpowers/plans/2026-05-14-agentic-terminal-refactor.md`.
- **2026-05-15** · PRD lock — AutoViral owns editing; sibling skills split into taste + engineering. See `docs/superpowers/plans/2026-05-15-autoviral-absorb-hyperframes-tech.md`.
- **2026-05-15** · Adopted mattpocock skills (`to-prd` / `to-issues` / `triage` / `diagnose` / `tdd` / `handoff` / `caveman` / `prototype` / `zoom-out` / `grill-me` / `improve-codebase-architecture` / `write-a-skill` / `find-skills`) as the engineering-process skill family. Replaces superpowers:* in this project. See `memory/feedback_use_mattpocock_not_superpowers.md`.
- **2026-05-17** · Right-pane dual-surface decision — Chat (`claude -p` subprocess) coexists with Terminal (xterm.js) as horizontal-tabbed siblings. Default surface: Chat. Both consume the same focus channel from H0. See [ADR-005](docs/adr/ADR-005-dual-chat-entry-layout.md). Resolves M.1 ([Issue #6](https://github.com/nanxingw/AutoViral/issues/6)).

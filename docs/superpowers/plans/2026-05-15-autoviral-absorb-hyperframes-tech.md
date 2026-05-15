# AutoViral 自家剪辑层 · 吸收 hyperframes 技术力 · 工位协作扩展

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this PRD task-by-task. Subordinate implementation plans will be produced from this PRD by `to-issues`.
>
> **Branch:** `refactor/agentic-terminal`
> **Date:** 2026-05-15
> **Status:** PRD · ready-for-agent
> **Source:** Conversation 2026-05-15 (compacted from earlier session 8de8e027)

---

## Problem Statement

AutoViral 当前是一个被混淆定位的创作工位，既有自家的 Remotion 剪辑栈，又装了 hyperframes 当摆设。具体痛点：

1. **质量门禁缺失** —— 字幕背景对比度不足、字幕长度撞屏边、tween 节奏死区，全靠 reviewer 肉眼，无任何自动检测。一次 render 5 分钟才发现文字溢出 = 闭环成本极高。
2. **无 composition 模板能力** —— 想做 10 张产品卡片 carousel 必须复制 10 份 composition.yaml 手改。批量内容生产事实上无法运行。
3. **字幕动画贫瘠** —— 现 CaptionsLayer 只有 `slide-up` / `fade` 入场 + 基础颜色高亮。hyperframes 那套 marker-sweep / scribble / burst / slam 在我们这边零覆盖。
4. **TTS preprocess 缺失** —— 文本到视频需求里"先用 AI 配音"是高频路径，AutoViral 无原生入口，用户必须跳出工具链。
5. **Agent 看不到用户当前焦点** —— terminal 里 agent 只拿到 `AUTOVIRAL_WORK_ID` 静态 env，用户在 timeline 选中哪个 clip、playhead 在 12.3s、focus 在哪个 panel 全部不可见。用户每次都要描述"我刚才点的那个"。
6. **架构混淆遗留** —— hyperframes 在 postinstall 自动安装、ingest recipe 引用 hyperframes、skill 描述里"bring your own taste skill 比如 hyperframes"。但实际从未被调用，是死库。
7. **Skill 边界不清** —— `skills/autoviral/` 当前混杂了"工位操作"（应留）和"剪辑工艺细节"（taste 部分应外迁、capability 部分应教得更专业）。新装的 `mattpocock/skills` 14 个工程过程 skill 落到了 `.agents/skills/` 但未 gitignore、未承认在 SKILL.md 里。

## Solution

**架构定位敲定**：AutoViral = 完整剪辑层 + 工位 + 协议；外部 sibling skills 分两类：**taste / craft**（教 *what to make*）和 **engineering / process**（教 *how to collaborate*）。**hyperframes 不集成、不预装**，但从代码层吸收其 5 块技术资产里的 4 块。

具体动作分 5 个 phase + 1 个 cleanup：

- **H0 · Shared Focus** —— frontend selection store + agent context channel + terminal 自动注入
- **H1 · Quality Gate 四件套** —— `lint` / `inspect` / `validate` / `animation-map` 抄 hyperframes 的 puppeteer 范式
- **H2 · Composition Variables** —— `${id}` 模板插值 + batch render
- **H3 · 字幕动画库扩展** —— 6 种新 highlight type
- **H4 · TTS Preprocess** —— OpenAI TTS adapter + 资产自动落地
- **Cleanup** —— 删 `installHyperframes()`、改 SKILL.md sibling 描述、`.agents/` gitignore 决策、recipe 重写

## User Stories

### 创作者视角

1. As a video editor, I want my captions checked for text overflow before render, so I don't waste 5 minutes rendering only to discover text spilled offscreen.
2. As a creator targeting accessibility, I want WCAG contrast warnings on caption layers, so my videos remain readable across all screens.
3. As a creator making product carousels, I want to declare a composition template once with typed variables, so I can render 10 product cards without copy-pasting YAML.
4. As a creator running a campaign, I want batch render driven by a JSON file mapping variables to renders, so I can produce a 30-variant overnight render.
5. As a creator, I want caption highlight effects beyond fade and slide-up — marker sweep, burst lines, scribble, slam, elastic — so my videos don't feel templated.
6. As a creator with text-only scripts, I want to generate narration audio via TTS without leaving AutoViral, so I have one tool not five.
7. As a creator working with an agent, I want the agent to know which clip I'm looking at when I type "make this brighter," so I don't have to describe my selection every time.
8. As a creator chasing trends, I want platform trend data (douyin / bilibili / youtube same-topic) queryable from my agent, so it can inform brief writing without me copy-pasting links.
9. As a returning user, I want my creation history (recent works, common aspect ratios, preferred caption fonts) queryable from my agent, so suggestions match my style automatically.
10. As a creator, I want the Studio playhead and terminal context to stay in sync — when I seek to 15s in the timeline, the next thing I type to the agent should know about that seek.

### Agent (terminal CLI) 视角

11. As a Claude agent in the terminal, I want to call `autoviral context --watch` and stream real-time UI focus state, so I respond to user intent without polling.
12. As an agent, I want `autoviral check` to be one command that runs all four quality gates and returns machine-readable JSON, so I don't have to compose four commands.
13. As an agent, I want `autoviral lint --json` / `inspect --json` / `validate --json` / `animation-map --json` to emit structured findings with selectors, timestamps, and fix hints, so I can iterate deterministically.
14. As an agent writing a composition, I want to declare variables in composition.yaml and reference them with `${id}` interpolation, so one composition renders N versions.
15. As an agent, I want `autoviral export --variables '{...}'` and `autoviral export --variables-file batch/` to render one or many variant outputs, so batch rendering doesn't require shell glue.
16. As an agent, I want to call `autoviral preprocess tts "narration text" --voice alloy` and immediately get back an audio asset path I can add to a track, so narration is a one-step workflow.
17. As an agent extending caption animations, I want `highlight.type` to be an enum with declared options (marker-sweep / scribble / burst / slam / elastic / clip-reveal), so I don't invent CSS — I pick from the library.
18. As an agent collaborating with the user, I want their terminal input to auto-prepend `[ctx: clip=vc_s07 seg=seg_0023 head=12.3s panel=timeline]`, so I know visual focus without asking.
19. As an agent, I want the context-injection prefix line to be **visible** in the terminal (dim gray, single line), so the user can see why I responded that way and turn injection off if it's wrong.
20. As an agent doing post-render review, I want `animation-map --json` to flag tween dead zones (>1s no animation), staggers, and out-of-canvas elements, so I catch choreography issues at zero render cost.

### Sibling skill author 视角

21. As an `editorial-pro` skill author, I want AutoViral to delegate taste decisions cleanly (it provides commands, I provide the brief), so my skill stays portable across creator workstations.
22. As a `mattpocock/handoff` skill user, I want `handoff` to work in AutoViral sessions without conflict, so I can compact a long session and pass it to a fresh agent.
23. As an `editorial-pro` skill, I want `autoviral` CLI to expose `trends` and `profile` queries, so my brief generation can reference real platform signals and user history.

### Maintainer / collaborator 视角

24. As a teammate cloning AutoViral, I want the project-local `.agents/skills/` mattpocock bundle to either come with the repo OR be cleanly gitignored — not in untracked limbo polluting `git status`.
25. As an AutoViral maintainer, I want all hyperframes installation artifacts (`installHyperframes()` in `src/postinstall.ts`, references in `recipes/ingest-youtube.md`, the "bring your own taste skill — hyperframes" line in SKILL.md) cleaned up, so the codebase doesn't carry an unused architectural fork.
26. As an AutoViral maintainer, I want SKILL.md to honestly describe the new sibling-skill split (taste + engineering process), so future agents understand the ecosystem they're entering.
27. As an AutoViral maintainer, I want each deep module (`focus/`, `context/`, `composition/variables/`, `composition/quality/`) testable in isolation per the test plan below, so refactors stay safe.
28. As a reviewer, I want `autoviral check` to be runnable in CI alongside `npm run test:web`, so quality regressions block merge.

## Implementation Decisions

### Module decomposition (deep-module-oriented per Ousterhout)

| Path | Type | Interface | Internal complexity |
|---|---|---|---|
| `src/focus/` | 🟢 deep | `read(workId) → FocusSnapshot` · `write(workId, patch)` · `subscribe(workId, cb)` | UI focus SSoT: selected clip/segment, playhead, panel focus, hovered element. WS-broadcast on change. |
| `src/context/` | 🟢 deep | `getContext(workId) → AgentContext` · `streamContext(workId) → AsyncIterable` | Aggregator: focus + work meta + composition meta + trends + profile → agent-readable JSON shape. |
| `src/composition/variables/` | 🟢 deep | `validateDeclarations(comp) → Issue[]` · `resolve(comp, overrides) → ResolvedComposition` · `interpolate(str, vars) → str` | Schema for `variables: []`, `${id}` interpolation, type validation, defaults merging, per-instance overrides. |
| `src/composition/quality/` | 🟢 deep | `lint(comp) → Issue[]` · `inspect(comp) → LayoutReport` · `validate(comp) → WCAGReport` · `animationMap(comp) → TweenGantt` | Puppeteer-based composition introspection harness. Renders via Remotion server, samples frames, runs 4 inspectors over the same render. |
| `src/providers/tts/` | 🟡 shallow | `synthesize({text, voice, format}) → AudioAsset` | OpenAI TTS / OpenRouter wrapper plugged into existing provider registry. Drops audio into `assets/audio/` + emits asset event. |
| `web/src/stores/focus.ts` | 🟢 deep | `useFocus()` hook · `setSelection(kind, id)` · `setPlayhead(s)` · `setPanelFocus(panelId)` · `subscribe()` | Zustand-style client SSoT. Mirrors `web/src/stores/toast.ts` style. Pushes changes to backend via bridge WS. |

### Architectural decisions

- **Renderer stays Remotion.** HTML+CSS+GSAP composition language (hyperframes' core) is explicitly NOT adopted. Migrating Studio's React/Remotion stack would require rewriting 19 existing works + Studio renderer + Tweaks panel. Cost > benefit.
- **Quality gate uses Puppeteer** for frame sampling and DOM introspection, matching hyperframes' proven approach. The 4 inspectors (lint / inspect / validate / animation-map) share a single render harness to keep gate runs fast (~30s vs 4×).
- **Composition variables follow hyperframes' shape** for portability: types are `string | number | color | boolean | enum`; enum entries declare `options: [{value, label}]`. Override sources: declared defaults → composition-level overrides → `--variables` CLI flag.
- **Caption animation library** is enum-extended on `highlight.type`. Each type owns a Remotion sub-renderer in `CaptionsLayer.tsx`. Six new types: `marker-sweep | scribble | burst | slam | elastic | clip-reveal`. The existing `basic-color` (default) stays for backward compatibility.
- **TTS goes through providers registry** for consistency with NanoBanana (image) and Seedance (video). New provider class lives in `src/providers/tts/`.
- **Context channel uses two transports**: HTTP GET `/context` for one-shot snapshots; existing bridge WS for `--watch` streaming. No new socket type.
- **Terminal context injection is visible.** The dim-gray `[ctx: ...]` prefix line is rendered in the terminal pane (xterm.js write of an ANSI-styled line) before each user submission. User can disable via `autoviral context --inject off`.
- **Hyperframes is NOT auto-installed.** `installHyperframes()` in `src/postinstall.ts` is deleted. Users wanting hyperframes can install it manually via `npx skills add heygen-com/hyperframes`.
- **mattpocock skills (`.agents/skills/`) commit decision:** lean toward **committing to the repo** so teammates inherit the engineering workflow (handoff / caveman / diagnose / tdd / to-issues / triage / prototype / zoom-out / grill-me / write-a-skill etc). Treat `setup-matt-pocock-skills/` as one-time scaffold; its `disable-model-invocation: true` already prevents accidental triggers.
- **Sibling skill landscape acknowledged in SKILL.md.** Two flavors documented: **taste / craft** (`editorial-pro` and the like — WHAT to make) and **engineering / process** (`mattpocock/*` — HOW to collaborate).

### API contracts (wire-level surface)

```
GET  /context?workId=<id>
     → 200 { workId, focus, work, composition: {duration, trackCount, captionCount}, trends, profile }

WS   { kind: "focus-changed", workId, focus }
WS   { kind: "context-updated", workId, fields: ["trends", "profile"] }

POST /quality/lint          { workId } → 200 { issues: Issue[] }
POST /quality/inspect       { workId, samples?: number, at?: number[] } → 200 { findings: LayoutFinding[] }
POST /quality/validate      { workId } → 200 { warnings: WCAGWarning[] }
POST /quality/animation-map { workId } → 200 { tweens: TweenSummary[], deadZones, staggers, asciiGantt }

GET  /variables/resolve?workId=<id>&overrides=<json> 
     → 200 { declarations, defaults, resolved, issues }
POST /export                { workId, variables?, variablesFile? } → 200 { jobId, outputPath }

POST /preprocess/tts        { text, voice, format?, workId } 
     → 200 { assetPath, durationSec }
```

### Schema changes (`src/shared/composition.ts`)

```ts
// New optional top-level field
variables?: Array<{
  id: string;
  type: "string" | "number" | "color" | "boolean" | "enum";
  label: string;
  default: string | number | boolean;
  options?: Array<{ value: string; label: string }>;  // required for "enum"
}>;

// Extended on CaptionGroupAnimation
highlight: {
  type?: "basic-color" | "marker-sweep" | "scribble" | "burst" 
       | "slam" | "elastic" | "clip-reveal";  // default "basic-color"
  activeColor: string;
  dimColor?: string;
  activeScale?: number;
  // type-specific:
  sweepDuration?: number;       // marker-sweep
  scribblePath?: "underline" | "circle" | "strike";  // scribble
  burstLineCount?: number;      // burst
  slamScale?: number;           // slam
  elasticOvershoot?: number;    // elastic
};
```

### CLI surface additions

```
autoviral context [--watch]
autoviral lint [--json]
autoviral inspect [--at <times>] [--samples <n>] [--json]
autoviral validate [--no-contrast] [--json]
autoviral animation-map [--json]
autoviral check                        # runs lint+inspect+validate+animation-map
autoviral export --variables '{...}'   # extended
autoviral export --variables-file <path>
autoviral preprocess tts <text> --voice <id> --out <path>
autoviral trends <topic> [--platform douyin|bilibili|youtube]
autoviral profile                      # user's creation history snapshot
```

### Exit-code additions (extends `contracts/error-codes.md`)

| Code | Meaning |
|---|---|
| 5 | Quality gate WARNINGS (informational; non-blocking) |
| 6 | Quality gate ERRORS (blocking — must fix before render) |

### Cleanup decisions

- Delete `installHyperframes()` from `src/postinstall.ts` + the helper functions it calls.
- Rewrite the `recipes/ingest-youtube.md` section referencing hyperframes to describe AutoViral's own ingest pipeline as the canonical path.
- Update SKILL.md "AutoViral has no opinion on what makes a video good" paragraph to describe the taste / engineering sibling split.
- Add `.agents/skills/setup-matt-pocock-skills/` to a `.gitkeep`-style commit (kept as scaffold reference, never auto-invoked).
- Either `git add .agents/skills/` (commit bundle) or add `.agents/` to `.gitignore` — decision to confirm before commit.

## Testing Decisions

### Definition of a good test

Per Ousterhout: test what the module *promises*, not how it *computes*. Examples:

- ✅ `interpolate("${title} costs ${price}", {title:"Pro", price:"$29"}) === "Pro costs $29"` — tests the contract.
- ❌ Asserting the internal regex matches a specific pattern — tests an implementation detail.
- ✅ `focus.subscribe(workId, cb); focus.write(workId, {playhead: 5}); expect(cb).toHaveBeenCalledWith({playhead: 5})` — tests broadcast contract.
- ❌ Asserting the WS frame format hex bytes — tests transport, not the focus module.
- ✅ Feed `quality.lint` a composition with an overlapping track, assert the returned issue includes the offending clip ids — tests the lint contract.
- ❌ Asserting the puppeteer command-line args — tests an internal coupling.

### Modules and their test types

| Module | Test type | Coverage focus | Prior art reference |
|---|---|---|---|
| `src/focus/` | unit + contract | CRUD round-trip; subscriber broadcast fires; WS event schema stable | `src/server/__tests__/render.test.ts` |
| `src/context/` | unit + snapshot | Aggregation shape; JSON output stays stable across feature additions | `src/server/bridge/__tests__/ingest-youtube.test.ts` |
| `src/composition/variables/` | unit + property | Interpolation correctness; type validation; defaults merging; property-test interpolation against fuzzed input strings | New — fastcheck-style property test pattern to be established |
| `src/composition/quality/` | unit + e2e fixtures | Lint rules (unit). Inspect/validate/animation-map need real render — keep 3 canonical fixture compositions in `__tests__/quality-fixtures/` and assert findings on them | `src/server/__tests__/render.test.ts` (Remotion fixture pattern) |
| `web/src/stores/focus.ts` | hook test (vitest) | Selection write triggers subscribers; bridge sync fires; restoration on reload | `web/src/features/studio/hooks/useWaveform.test.ts` |
| `src/providers/tts/` | e2e happy path | Single successful synthesis end-to-end (network-dependent; skipped in CI default, run in nightly) | `src/providers/__tests__/` if exists; otherwise new pattern |
| `CaptionsLayer.tsx` extensions | snapshot test | Each new `highlight.type` renders deterministic DOM at t=0 and t=mid | `web/src/features/studio/composition/captions/*.test.tsx` if exists; otherwise new |

### Test discipline rules

- **No mocking the backend in `src/server/bridge/__tests__/`** — they're integration tests, hit real server.
- **`maxThreads: 2` / `maxForks: 2` per CLAUDE.md** — must not be lifted.
- **Each quality-fixture composition** has a paired `expected.json` of findings; assertions compare `actual.findings.map(pick(["id","timeSec","selector"]))` against expected. Avoid asserting on prose fields that may change copy.

## Out of Scope

Explicitly **not** in this PRD's scope; each is a possible follow-up:

- **HTML composition language** (hyperframes' core authoring model) — not adopted; Remotion stays.
- **Sub-compositions via composition-as-clip reference** — defer to a later PRD if users hit reuse pain.
- **Shader transitions / WebGL** — too heavy for ROI; defer indefinitely.
- **GSAP / Anime / Lottie / Three / WAAPI adapters** — Remotion's spring/interpolate suffices; defer.
- **`remove-background` (rembg) preprocessor** — niche; defer to a follow-up PRD.
- **8 named hyperframes visual styles / init templates** — taste content; belongs in a sibling skill (`editorial-pro` and friends), not in AutoViral.
- **`design.md` design-picker UI** — defer.
- **Multi-platform trends UI surface** — the data layer (`src/trends/sources/`) is exposed via CLI; visual dashboard is a separate PRD.
- **User profile dashboard UI** — `autoviral profile` CLI is in scope; React surfacing is separate.
- **Setup `mattpocock` issue tracker** — `setup-matt-pocock-skills/` exists; run interactively when first using `to-issues` / `triage`.
- **Backwards compat for old works** — existing 19 works on this branch are forward-compatible (`variables` is optional, `highlight.type` defaults to `basic-color`). No migration script needed.

## Further Notes

### Recommended phase order (smallest-surface-first)

1. **H0 · Shared Focus** — smallest, unlocks agent paradigm immediately, no schema changes.
2. **H2 · Composition Variables** — most user-visible win ("I can do templates now").
3. **H1 · Quality Gate** — engineering moat; unlocks "agent fixes its own caption mistakes" loop.
4. **H3 · Caption Animation Library** — visual richness boost; depends on no other phase.
5. **H4 · TTS Preprocess** — narration unlock; isolated.
6. **Cleanup** — hyperframes residue + SKILL.md update + `.gitignore` decision + recipe rewrites. Folded into the tail of each phase rather than a dedicated phase.

### Open decisions confirmed in-conversation

- ✅ Module split: `focus/` and `context/` stay separate (confirmed 2026-05-15).
- ✅ Test coverage: all 6 modules per recommendations (confirmed 2026-05-15).
- ✅ Strategy: AutoViral does the editing layer; hyperframes is absorbed not integrated (confirmed 2026-05-15).
- ⚠️ Open: `.agents/skills/` commit vs gitignore — lean toward commit but awaiting explicit user nod before any commit.

### Branch and workflow

- Continue on `refactor/agentic-terminal`.
- Each phase produces 1–3 commits; PRs are optional (project pattern is direct push on this branch).
- TaskList: `to-issues` will break this PRD into independently-grabbable issues (one per phase × 3–5 work units).

### Issue tracker note

`setup-matt-pocock-skills` has not been run. `to-prd`'s "publish to issue tracker + apply `ready-for-agent` label" step is **deferred**. This document is the authoritative artifact; once the user is ready to run the setup, the PRD content can be lifted to GitHub Issues automatically.

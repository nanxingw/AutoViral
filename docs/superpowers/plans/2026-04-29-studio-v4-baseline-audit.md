# Studio v4 Baseline Audit (2026-04-29)

> Reality snapshot of the 30 dirty files on `refactor/ui-v3-react` (HEAD `fcd71b9`,
> Phase 3.G fix-up) that constitute an in-progress, un-planned Studio v4 UI overhaul.
> WIP backup: branch `wip/studio-v4-snapshot` (commit `2ea68fa`). Every claim traces
> to a `path:line` reference. No source files were modified during this audit.

---

## 0. Audit Scope + Versions

| Probe | Result |
| --- | --- |
| Audit date | 2026-04-29 (Wed) CST |
| Repo HEAD SHA | `fcd71b9` (branch `refactor/ui-v3-react`) |
| WIP backup | `wip/studio-v4-snapshot` @ `2ea68fa` |
| Working-tree delta | **+3640 / −283** across 30 files (28 modified + 2 untracked) |
| TypeScript (`tsc --noEmit -p tsconfig.json`) | exit 0 — working tree compiles |
| Web tests | **165 pass / 4 fail / 0 skip** out of 169 (47 files; baseline before WIP was 169 pass) |
| Server tests | 72 pass + 1 skip (clean — WIP does not regress server) |
| New runtime deps | `react-markdown ^10.1.0`, `remark-gfm ^4.0.1` (`package.json:72,74`) |
| Master plan reference | **NONE** — no plan file references the Studio v4 redesign. Phase 4 (Timeline editing) of `docs/superpowers/plans/2026-04-28-autoviral-video-supremacy.md` is the next planned work and overlaps these files. |
| Reference design source | `autoviral design/studio-app.jsx` (~33 KB v4.0 mockup, also dirty), `autoviral design/Analytics.html`, `autoviral design/Image Editor.html`, `autoviral design/Works.html`, `autoviral design/shared.css`, `autoviral design/image-editor-app.jsx` |

**Key environment flags for Studio v4:**

- `react-markdown@^10` is a **major** version bump (v9 → v10 changed the `children` typing and dropped some plugin compat). Verify peer deps before merging — see Risk R1.
- The Phase 2 acceptance leak (`docs/superpowers/plans/2026-04-25-ui-redesign-02-video-studio.md` §2.5: "clicking 'Create asset' in the **asset sidebar**") was never satisfied by Plan 2. The WIP's new `AssetSidebar` is the implicit fix.
- Phase 4's planned target files (`Timeline/Clip.tsx`, `Track.tsx`, `index.tsx`) are *all* dirty in the WIP. Until this WIP is resolved or rebased, Phase 4 cannot start cleanly.

---

## 1. Executive Summary

The WIP implements a **Studio v4.0 visual redesign** that mirrors the `autoviral design/studio-app.jsx` mockup: it (a) replaces the right-hand `<TweaksPanel>` with a new `<AssetSidebar>` (closing the Phase 2 acceptance leak), (b) rewrites the Chat panel for chat-history seeding plus markdown rendering, (c) rewrites the Preview panel with a custom transport bar / scrubber / tabs, (d) restyles the TopBar with theme toggle and editorial branding, (e) restyles the Timeline (Track/Clip/Ruler) with kind-aware colour coding, (f) backfills cover-image attach + analytics/trends adapters at the data layer, and (g) syncs the design mockups under `autoviral design/`.

**Estimated completion: ~75-80%.** UI markup is in place and TypeScript compiles, but four tests fail (one analytics adapter contract bug, three Studio integration regressions caused by the new `AssetSidebar` requiring a `QueryClient` and the obsolete `<TweaksPanel>` testid `layer-brightness` no longer mounting). No new tests were written for the new behaviour (chat history hydration, asset listing, scrubber drag, carousel synthesise).

**Blast radius** is moderate but contained: the broken Studio integration test means Studio mount-time is *currently broken in tests*, but the runtime `main.tsx` already wraps the app in `<QueryClientProvider>` (web/src/main.tsx:26), so the production Studio renders fine. The `Editor.tsx` page was also reshelled to embed `<ChatPanel>` in place of `<SlidesNav>`, which is a meaningful UX change for image-text works that has no test coverage at all today.

The WIP is **multi-themed** but the themes are mostly orthogonal (chat / preview / asset-sidebar / timeline / data-adapters / design-sync) — they can be split into per-theme commits. The one cross-cutting concern is `globals.css` (+107 lines) which underpins multiple themes simultaneously and must land before or alongside any panel that consumes the new tokens (`.md-bubble`, pill-button defaults, accent swatches).

---

## 2. Theme Decomposition

Six coherent themes, ordered by dependency:

### Theme A — Global stylesheet + new deps  (foundation)

- **Files:** `web/src/styles/globals.css` (+107), `package.json` (+2), `package-lock.json` (~+1500 lock churn)
- **What it does:** Adds `react-markdown` + `remark-gfm` to deps; injects editorial CSS tokens and class rules used by every other theme:
  - `.font-editorial`, `.font-mono`, `.eyebrow` typography helpers
  - `@keyframes pulse-dot`, `slide-up`; `.pulse-dot`, `.slide-up` classes (chat thinking dots, message animation)
  - Default pill button rules (`.studio-shell button:not(.send-btn):not([data-accent-swatch])`) — the user-reported "no styling" fix
  - `.md-bubble` markdown stylesheet for Chat
  - Default text-input rules so chat / inspector inputs are no longer browser-grey
  - Accent swatch colours
- **Completion:** ~95% — coherent and self-contained. Risk: depends on `.studio-shell` selector; `Studio.tsx` already adds the class via the page wrapper, but `Editor.tsx` was retro-fitted in the same WIP (`web/src/pages/Editor.tsx:85`) so Editor benefits from the same rules.
- **Reference design:** `autoviral design/shared.css` (also dirty) — contains the master tokens.
- **Dependencies:** none. Must land **first** — every other theme reads CSS variables introduced here.

### Theme B — `AssetSidebar` (new feature, closes Phase 2 §2.5 acceptance)

- **Files:** `web/src/features/studio/panels/AssetSidebar/index.tsx` (+275, **new**), `web/src/queries/assets.ts` (+66, **new**), `web/src/pages/Studio.tsx` (rewires `aside` grid area)
- **What it does:** New right-hand panel that lists work assets bucketed into `CLIPS / IMAGES / AUDIO / TEXT` groups via `useWorkAssets(workId)`. Renders 9:16 thumbnail tiles with hover-play for video, lazy `<img>` for images, and an audio glyph fallback. Replaces the prior `<TweaksPanel>`.
- **Completion:** ~75%. Header has a `+` button labelled "Upload" (line 55) but it has no `onClick`. The Phase 2 acceptance text says it should *open the create-asset dialog*; that wiring is missing. Hover-play on `<video>` uses `onMouseEnter` on the *parent tile* but the play-handler is on `<video>` element → only fires on the inner element, mostly works but inconsistent.
- **Reference design:** `autoviral design/studio-app.jsx:405-470` (`function AssetSidebar()` with `mockAssets` group structure).
- **Dependencies:** Theme A (CSS tokens). Backend `/api/works/:id/assets` already exists (`src/server/api.ts:580-590`) — no new server endpoint needed.

### Theme C — Chat panel rewrite (history + markdown)

- **Files:** `web/src/features/studio/panels/Chat/index.tsx` (+424 / −53), `web/src/features/chat/store.ts` (adds `setBlocks`)
- **What it does:** Three concerns mixed into one rewrite:
  1. **Chat history hydration** on mount: `apiFetch<{blocks: StreamBlock[]}>('/api/works/<id>/chat')` seeds `useChatStore.setBlocks` with synthesised stable IDs. Filters `step_divider` legacy markers via `SKIP_TYPES`.
  2. **Visual rewrite** with editorial header (`✦` glyph, `CLAUDE-SONNET-4.5 · STREAMING` label, message count chip), bubble-styled messages with type-aware variants (user/assistant/tool/thinking), animated thinking-dots, multi-line composer with `⌘↵ SEND` hint.
  3. **Markdown rendering** via `<ReactMarkdown remarkPlugins={[remarkGfm]}>` inside assistant bubbles, scoped to `.md-bubble` CSS class.
- **Completion:** ~90% — works runtime, no automated coverage for any of the three concerns.
- **Reference design:** `autoviral design/studio-app.jsx` (chat section, not split into a separate file in mockup).
- **Dependencies:** Theme A (`.md-bubble`, `.pulse-dot`, `.slide-up`). New deps: `react-markdown`, `remark-gfm`. `apiFetch` already exists at `web/src/lib/api.ts`. Backend `/api/works/:id/chat` is assumed but not verified in this audit.

### Theme D — Preview panel rewrite (transport bar + scrubber)

- **Files:** `web/src/features/studio/panels/PreviewPanel.tsx` (+455 / −20)
- **What it does:** Adds tab switcher (`预览 / 参考 / 对比` — only `预览` is wired to the Player; `ref` and `compare` are visual-only stubs), ambient grid SVG, side-meta overlay (`FRAME / CLIPS / EST. duration`), phone-frame canvas with safe-zone dashed border, and a fully custom transport bar that subscribes to `playerRef.addEventListener('frameupdate' | 'play' | 'pause')` to track playback. The new `<Scrubber>` component implements pointer-down + pointer-move drag-to-seek.
- **Completion:** ~70%. The transport works for the active tab but `tab` state has no effect on rendering — switching to `ref` / `compare` is silently a no-op. The `setPointerCapture` + `pointermove` listener pair on the scrubber is correct but `e.currentTarget` is captured at handler creation time and the synthetic-event recycling could bite — needs a smoke test.
- **Reference design:** `autoviral design/studio-app.jsx:181-285` (`function Preview()` with full tabbed shell).
- **Dependencies:** Theme A (CSS tokens). No data-layer dependency.

### Theme E — TopBar v4.0 styling (theme toggle, editorial brand)

- **Files:** `web/src/features/studio/panels/TopBar.tsx` (+149 / −44)
- **What it does:** Drops the shared `<Button>` import in favour of inline `<button data-bare>` elements with hand-styled gradients. Adds: back arrow, "Autoviral" editorial italic + "Studio · v4.0" eyebrow, work-id title, save-state chip with `--status-done` coloring, `useTheme()` toggle button (sun/moon SVG), gradient export button with `导出` label.
- **Completion:** ~95%. Works runtime, but **deviates from design mockup** in two ways: (a) the design has Search + Settings icon buttons between theme toggle and Export (`autoviral design/studio-app.jsx:31-32`); the WIP omits them. (b) the design's status indicator is `<StatusDot status="running" label="ASSETS · 5m 32s"/>` (a live-pipeline indicator); the WIP shows only `SAVED · {savedAt}` from props. Both omissions may be intentional scope-cuts.
- **Reference design:** `autoviral design/studio-app.jsx:4-37`.
- **Dependencies:** `useTheme` already exists at `web/src/stores/theme.ts:33` (no new code needed). Theme A for surface tokens.

### Theme F — Timeline restyle (Clip / Track / Ruler / zoom)

- **Files:** `web/src/features/studio/panels/Timeline/index.tsx` (+184 / −31), `Track.tsx` (+108 / −47), `Clip.tsx` (+98 / −13), and matching test updates `Clip.test.tsx`, `Track.test.tsx`
- **What it does:**
  - **`index.tsx`:** Adds zoom buttons (`-` / `+` with `0.4×–3×` range, current value display), inlines a new `<Ruler>` (was previously imported from `./Ruler`), removes the `<Playhead>` import and stops rendering it. Switches from `padding: 0 24px 16px 140px` (negative-margin label trick) to a flex layout with sticky label column. Tracks are mapped with `TRACK_COLORS` + `TRACK_LABELS` lookups and passed `totalWidth` / `color` / `label` props.
  - **`Track.tsx`:** New `Props`-typed signature `{track, pxPerSecond, totalWidth, color, label}`. Adds `KIND_ICON` lookup (4 SVGs), sticky 110-px label column with icon + label, dynamic 36/56-px height (text vs others). Removes the legacy "negative-left" label that lived outside the row.
  - **`Clip.tsx`:** Adds `trackKind` and `color` props, kind-aware gradient backgrounds (per-clip hue derived from `clip.id`, light/dark theme-aware), duration label + clip name (filename without extension). Selection uses `box-shadow: 0 0 12px var(--accent-glow)`.
  - **Tests** updated to pass the new mandatory props.
- **Completion:** ~85%. The legacy `<Playhead>` import was removed but `Playhead.tsx` still exists in the directory — possible dead code. The `<Ruler>` was inlined into `index.tsx` but the original `Ruler.tsx` file was not deleted (audit didn't verify deletion; check before commit). `light` theme detection uses `document.documentElement.getAttribute("data-theme")` synchronously inside `Clip` (Clip.tsx:34) which won't react to theme toggles — known limitation.
- **Reference design:** `autoviral design/studio-app.jsx:288-403`.
- **Dependencies:** Theme A. The two test files already updated themselves and pass — the remaining 3 Studio integration failures are *not* about Timeline directly (see §3).

### Theme G — Data-layer adapters + cover images (backfill)

- **Files:** `web/src/queries/analytics.ts` (+51 / −1), `web/src/queries/trends.ts` (+73 / −2), `web/src/queries/works.ts` (+4), `src/server/api.ts` (+60), `web/src/features/works/WorksGrid.tsx` (+84 / −34), `WorksGrid.module.css` (+4 / −2), `web/src/features/explore/TrendingPanel.tsx` (+12 / −3)
- **What it does:** Five micro-changes glued by the v4 polish theme:
  1. **`queries/analytics.ts`:** Wraps the response in an `adapt()` that *expects the nested shape* `{configured, data: {account, summary, ...}}` and returns `null` if `raw?.data?.account` is falsy. **This is the source of the failing Analytics test** — the MSW fixture (`web/src/test/msw.ts:33`) returns the legacy *flat* shape, so `adapt()` returns null and the page renders "No analytics data."
  2. **`queries/trends.ts`:** Adds platform-specific normalisers (xiaohongshu `videos[]` with Chinese-unit `万`/`亿` parser, douyin `topics[]` with `heat`-based likes, fallthrough for already-normalised). Adds a 404-→empty-list catch via `ApiError`.
  3. **`queries/works.ts`:** Adds optional `coverImage` / `coverIsVideo` fields to `WorkSummary`.
  4. **`src/server/api.ts`:** Two changes: (a) attaches `coverImage` / `coverIsVideo` to the `/api/works` list response by scanning each work's `output/` then `assets/images/`; (b) adds `synthesiseLegacyCarousel(workId, type)` and wires it into the `404` branch of `/api/works/:id/carousel` so legacy image-text works auto-build a slides array from `output/*.png`.
  5. **`WorksGrid.tsx` + `.module.css`:** Switches the gradient placeholder to either an `<img>` or a hover-playing `<video>` when `coverImage` is provided, with a per-work-id deterministic palette fallback (`fallbackGradient(id)` over 8 palettes).
  6. **`TrendingPanel.tsx`:** Empty-state copy `暂无该平台趋势数据` + `NO DATA` badge.
- **Completion:** ~80%. Functionally correct on real backend data, **but the analytics adapter is incompatible with the test mock** — this is the single root-cause of the analytics regression and easiest to fix by either (a) making `adapt()` tolerate both shapes, or (b) updating MSW to return the new shape.
- **Reference design:** `autoviral design/Works.html`, `Analytics.html` (also dirty in WIP).
- **Dependencies:** none on UI themes; can land in any order.

### Theme H — Design mockup sync + Editor shell unification + Filmstrip image bg

- **Files:** `autoviral design/*.{html,jsx,css}` (6 files, +38/−35 total — small diffs), `web/src/pages/Editor.tsx` (+35 / −20), `web/src/features/editor/panels/Filmstrip.tsx` (+56 / −20)
- **What it does:**
  1. Refreshes the design mockups (small content tweaks; aesthetics).
  2. **`Editor.tsx`** is reshelled to match Studio's grid pattern: `360px 1fr 320px` columns, `gap:12 padding:12`, replaces `<SlidesNav>` with `<ChatPanel>` in the left column, adds `.studio-shell` class so the new `globals.css` rules apply.
  3. **`Filmstrip.tsx`** now renders actual slide backgrounds (`solid` / `gradient` / `image`) — previously `image`-typed slides showed as blank surface-1 boxes.
- **Completion:** ~85% for the Editor reshelling; design-mockup sync is purely aesthetic and decoupled from code.
- **Reference design:** `autoviral design/Image Editor.html`, `image-editor-app.jsx`.
- **Dependencies:** Theme A (`.studio-shell` rules), Theme C (`<ChatPanel>` is shared).

---

## 3. Failed Test Root-Cause Analysis

Vitest run command:

```bash
npx vitest --config web/vitest.config.ts run \
  web/src/features/studio/Studio.integration.test.tsx \
  web/src/features/analytics/Analytics.test.tsx
```

Result: **4 failed / 0 passed in these files** (full suite: 165 pass / 4 fail / 0 skip / 169 total).

### 3.1 `Studio.integration.test.tsx > mounts with empty composition and renders Player`

- **Failure:** `Error: No QueryClient set, use QueryClientProvider to set one`
- **Stack:** thrown from `useWorkAssets` (`web/src/queries/assets.ts:37`) called by `<AssetSidebar>` at `web/src/features/studio/panels/AssetSidebar/index.tsx:15`.
- **Root cause:** The test's `mount()` helper (`Studio.integration.test.tsx:39`) wraps the page only in `<MemoryRouter>` — there is no `<QueryClientProvider>`. Studio v3 didn't need one because the `<TweaksPanel>` had no React Query hooks. The new `<AssetSidebar>` calls `useQuery` unconditionally on mount even when `enabled: !!workId` — `useQuery` still requires the QueryClient context to *check* `enabled`.
- **Fix scope:** Update the test's `mount()` helper to include `<QueryClientProvider>` (mirroring the pattern in `Analytics.test.tsx:9`). Single helper change unblocks all three failing Studio tests.

### 3.2 `Studio.integration.test.tsx > adding a clip surfaces it on the timeline`

- **Failure:** Same `No QueryClient set` error.
- **Root cause:** Identical to §3.1 — the test never gets past Studio mount.
- **Fix scope:** Subsumed by §3.1's `mount()` helper fix.

### 3.3 `Studio.integration.test.tsx > brightness slider in Tweaks writes through to the store`

- **Failure:** Same `No QueryClient set` at mount. **However**, even after fixing §3.1, this test will still fail in a new way: it does `findByTestId("layer-brightness")`, but `data-testid="layer-brightness"` is rendered by `LayerSection.tsx:63` which lives **inside `<TweaksPanel>`**, and `<TweaksPanel>` is *no longer mounted by Studio.tsx* (replaced by `<AssetSidebar>`). The `Tweaks/` directory still exists (`web/src/features/studio/panels/Tweaks/{index,LayerSection,...}.tsx`) but nothing imports it for the Studio page. Reference: `web/src/pages/Studio.tsx:120` now mounts `<AssetSidebar>`.
- **Root cause:** Two layered failures. Layer 1 = QueryClient (§3.1). Layer 2 = test asserts on UI that no longer exists.
- **Fix scope:** This test cannot be saved by a small change. Two options:
  - **(a) Delete the test** since the brightness mutation contract is already covered by `LayerSection.test.tsx` which mounts `LayerSection` directly.
  - **(b) Replace it** with a test that mounts `<TweaksPanel>` standalone (the panel still exists, just isn't routed). This preserves coverage without depending on Studio's grid.
- **Recommendation:** Option (b). The brightness flow is genuine product behaviour even though Tweaks is no longer the right-rail panel — it may resurface as a side-drawer or dialog in Phase 4+.

### 3.4 `Analytics.test.tsx > renders hero KPIs and profile when data loaded`

- **Failure:** `Unable to find an element with the text: /@alex_creates/i`. DOM shows `<main class="page">No analytics data.</main>`.
- **Root cause:** `web/src/queries/analytics.ts` Theme G (1) introduced an `adapt()` that requires `raw?.data?.account` (line 32). The MSW fixture in `web/src/test/msw.ts:33-50` returns the **legacy flat shape** `{account, summary, ...}` (no `data:` wrapper). So `adapt()` returns `null`, `useCreatorAnalytics().data` is null, and `Analytics.tsx:13` short-circuits to "No analytics data."
- **Fix scope:** Two acceptable fixes:
  - **(a) Make `adapt()` tolerate both shapes** — preferred because it preserves backward compat with any older real backend response. Branch on `raw?.data?.account ?? raw?.account`.
  - **(b) Update MSW fixture to nested shape** — only acceptable if the controller can confirm the production backend always returns the nested shape. (Audit didn't verify the live `/api/analytics/creator` response — flag for clarification.)
- Either way, no source-side code change is required to the Analytics page itself.

---

## 4. Cross-Task Interface Contracts

Contracts the WIP introduces that downstream Phases (4-8) and any per-task split must preserve.

### 4.1 `<AssetSidebar>` props + grid position

```tsx
// web/src/features/studio/panels/AssetSidebar/index.tsx:4
interface Props { workId: string; }
```

Mounted at `gridArea: "aside"` in Studio.tsx — replaces the prior `<TweaksPanel>` slot. Studio grid changed (Studio.tsx:90-94):

| Aspect | Before (v3) | After (v4 WIP) |
| --- | --- | --- |
| `gridTemplateColumns` | `360px 1fr 300px` | `360px 1fr 320px` |
| `gridTemplateRows` | `56px 1fr 320px` | `56px 1fr 280px` |
| Outer `height` | `calc(100vh - 56px)` | `100vh` |
| Outer `padding` | (none) | `12` (with `gap: 12`) |
| Right-rail | `<TweaksPanel/>` | `<AssetSidebar workId={workId}/>` |
| Areas | `"top top top" "chat preview aside" "chat timeline aside"` | identical |

### 4.2 `useWorkAssets(workId)` query shape

```ts
// web/src/queries/assets.ts:36
export function useWorkAssets(workId: string | null): UseQueryResult<AssetGroup[]>;
export interface AssetGroup { group: string; count: number; items: AssetItem[]; }
export interface AssetItem {
  path: string;          // "assets/clips/intro.mp4" or "output/final.mp4"
  url: string;           // "/api/works/<id>/assets/<encoded path>"
  kind: "video" | "audio" | "image" | "text" | "other";
  ext: string;           // lowercase, no dot
  name: string;          // basename for display
}
```

Group keys returned in fixed order, only when non-empty: `CLIPS, IMAGES, AUDIO, TEXT`. The `other` bucket exists in `classify()` (line 33) but is **dropped** by the post-filter (line 62) — orphan files like `chat.json` won't surface in the sidebar. This is intentional but undocumented; downstream features that want all assets (e.g. an admin debug panel) need a sibling query.

### 4.3 Backend `synthesiseLegacyCarousel(workId, workType)` contract

```ts
// src/server/api.ts:476-516
async function synthesiseLegacyCarousel(workId: string, workType: string)
  : Promise<unknown | null>;
```

- Returns `null` when `workType !== "image-text"` — short-video works are explicitly out of scope.
- Returns `null` when both `output/*.{png,jpe?g,webp}` and `assets/images/*` are empty.
- Otherwise returns a `{id, workId, width: 1080, height: 1350, globals: {…}, slides: [{id, bg: {type:"image", value:url}, layers:[]}], updatedAt}` shape that the `/api/works/:id/carousel` `GET` returns directly (no schema validation downstream — frontend `Editor.tsx` consumes it raw).
- **Side-effect-free** — does not write yaml. Consumers calling `PUT /api/works/:id/carousel` will persist whatever they then submit.

### 4.4 Chat panel markdown rendering contract

- Renders **only** the `markdown` segment of `segmentTextWithLocators(text)` through `<ReactMarkdown remarkPlugins={[remarkGfm]}>`. Locator segments still use the existing `<LocatorBlockView>` flow.
- `remark-gfm` enables: tables, strikethrough, task lists, autolink. No `rehype-` plugins enabled — raw HTML is **escaped** by default (react-markdown v10 default behaviour).
- Container class is `.md-bubble`; the stylesheet at `globals.css` styles `p / strong / em / code / pre / ul / ol / h1-h4 / blockquote / a / hr / table` within that scope.
- `setBlocks(blocks: StreamBlock[])` is added to `useChatStore` (`web/src/features/chat/store.ts:8`); not currently called by the WS streamer (only by `ChatPanel.useEffect` for history seed).

### 4.5 `useTheme()` in TopBar

`useTheme` is **pre-existing** at `web/src/stores/theme.ts:33`. The TopBar diff merely starts consuming it. No new store work needed.

### 4.6 WorkSummary cover-image contract

```ts
// web/src/queries/works.ts:7-14
interface WorkSummary {
  /* …existing fields… */
  coverImage?: string | null;  // absolute /api/works/<id>/assets/... URL
  coverIsVideo?: boolean;       // true ⇒ render as <video> with hover-play
}
```

Server attach order (`src/server/api.ts:148-172`):
1. First `output/*.png` → image cover
2. Else first `assets/images/*` → image cover
3. Else first final video → video cover with `coverIsVideo: true`
4. Else `coverImage` is omitted.

Empty works (no assets) get neither field — `WorksGrid` falls back to `fallbackGradient(id)`.

### 4.7 Editor shell unification

`Editor.tsx` now uses Studio's `360px 1fr 320px` grid and mounts `<ChatPanel workId={workId}/>` in the left column instead of `<SlidesNav>`. This is a **breaking UX change for image-text works** — slide navigation was the primary affordance there. There is no test coverage for the Editor mount today, so the regression is silent. The `<SlidesNav>` component still exists but is not imported anywhere — possible dead code.

---

## 5. Plan-vs-Reality Drifts

Concrete inconsistencies discovered during the audit. Order: severity-descending.

### D1 — Tweaks panel orphaned but kept on disk

- `web/src/features/studio/panels/Tweaks/{index,ThemeSection,DensitySection,LayerSection,CompositionSection}.tsx` are no longer imported by Studio.tsx (the WIP removed `import { TweaksPanel } from "@/features/studio/panels/Tweaks";`).
- `LayerSection.test.tsx` still passes because it mounts `LayerSection` directly.
- `Studio.integration.test.tsx:75-95` still asserts on `data-testid="layer-brightness"` which only exists inside Tweaks → broken (see §3.3).
- **Decision required from controller:** delete Tweaks tree, or treat it as "future side-drawer" stash and just fix the test? See task split.

### D2 — `Analytics adapt()` requires nested shape that the test fixture doesn't provide

- See §3.4. The MSW shape may also disagree with the real backend; audit cannot verify without launching the server. **Flag for user clarification.**

### D3 — `Studio.integration.test.tsx` `mount()` helper missing `QueryClientProvider`

- See §3.1. Pure test harness drift.

### D4 — `<AssetSidebar>` "Upload" button has no handler

- `AssetSidebar/index.tsx:54-72` renders an icon button with `aria-label="Upload"` but no `onClick`. The Phase 2 §2.5 acceptance text expected this to *open the create-asset dialog*. Either the dialog is out of scope (then rename label / remove button) or it's a pending TODO.

### D5 — Preview panel `tab` state is half-wired

- `PreviewPanel.tsx:17` has `useState<"preview" | "ref" | "compare">`, three buttons render and toggle the variable, but the rendered viewport ignores `tab` entirely — `<Player>` always mounts regardless. Either complete the tabs or remove the unused state.

### D6 — Timeline removed `<Playhead>` and (likely) inlined `<Ruler>` without deleting the source files

- `Timeline/index.tsx` no longer imports `Playhead`; the original `Ruler.tsx` was inlined into a local function. Audit did not verify file deletion. Probable dead code: `Timeline/Playhead.tsx`, `Timeline/Ruler.tsx`. Leaves stale imports possible.

### D7 — `<SlidesNav>` orphaned in Editor

- `web/src/pages/Editor.tsx` no longer imports `SlidesNav` — same orphaning pattern as Tweaks. Potential dead code at `web/src/features/editor/panels/SlidesNav.tsx`.

### D8 — Lock file churn (~+1500 lines)

- Two new deps cascade into many transitive packages (react-markdown depends on `unified`, `mdast-util-*`, `micromark-*`, `vfile`). Lock-file diff is huge and noisy but not load-bearing — must accompany whichever commit introduces `package.json` change.

### D9 — `react-markdown@^10` peer-dep verification not done

- v10 dropped some plugin compat. `remark-gfm@^4` is the matched major. Audit verified TypeScript compiles and tests don't blow up on import — runtime markdown rendering not exercised by automated tests. Smoke test recommended.

### D10 — `Clip.tsx` light-theme detection is non-reactive

- `Clip.tsx:34` reads `document.documentElement.getAttribute("data-theme")` once during render — switching the theme toggle in `useTheme()` will re-render via Zustand subscriptions, **but** if `data-theme` attribute write is batched after render, the theme detection will be stale by one tick. Acceptable for now; flag for Phase 4 integration.

### D11 — `WorksGrid` has no test, but contract changed (added optional cover fields, swapped `<div>` placeholder for conditional `<img>/<video>/<div>`)

- Behaviour change is visible at runtime only. Manual smoke required for the Works grid → Studio routing flow.

---

## 6. Task Decomposition Recommendation

Goal: convert the 30-file WIP into a sequence of clean, per-commit, TDD-driven tasks such that after the last commit:

- Working tree is clean (`git status` empty)
- All 165 currently-passing tests still pass
- The 4 currently-failing tests are either fixed (preferred) or replaced with equivalent coverage
- TypeScript still compiles
- Server tests stay 72 / 1-skip
- Phase 4 (Timeline editing) can branch from a clean tip

**Proposed ordering** (12 tasks, dependency-respecting):

| ID | Title | Files | Depends on | LoC est. | Test strategy |
| --- | --- | --- | --- | --- | --- |
| **4S.0** | Update `Studio.integration.test` `mount()` to wrap in `QueryClientProvider` (red→green for §3.1, §3.2) | `web/src/features/studio/Studio.integration.test.tsx` | — | ~10 | Unit-update; this test goes red first because we add a QueryClient that exposes the AssetSidebar mount — but Studio.tsx still uses TweaksPanel pre-WIP, so we *also* need to either keep the test green by adding `<QueryClientProvider>` *first*, before any Studio change. Pure helper change. |
| **4S.1** | Land global stylesheet + new deps (Theme A) | `package.json`, `package-lock.json`, `web/src/styles/globals.css` | 4S.0 | +107 css, +2 deps | No test; visual diff only. Verify `tsc --noEmit` and full suite still pass. |
| **4S.2** | Add `useWorkAssets` query + minimal `<AssetSidebar>` (Theme B core) — write a unit test for the query's `classify`+`group` logic against a fixture | `web/src/queries/assets.ts` (new), `web/src/queries/assets.test.ts` (new), `web/src/features/studio/panels/AssetSidebar/index.tsx` (new) | 4S.1 | +275 + ~80 test | Unit test the bucketing pure function; render-test with MSW fixture asserts 4 group chips + tile count. |
| **4S.3** | Wire `<AssetSidebar>` into `Studio.tsx` grid, drop `<TweaksPanel>` import, update Studio integration test to either delete or rewrite the brightness-slider test (Theme B integration + D1, D3) | `web/src/pages/Studio.tsx`, `web/src/features/studio/Studio.integration.test.tsx`, **delete** `web/src/features/studio/panels/Tweaks/` (controller decision) | 4S.0, 4S.2 | ~30 src + ~30 test | Test rewrite: replace brightness-slider Studio-mount test with a direct `<TweaksPanel>` (or `<LayerSection>`) mount test if the panel is kept; otherwise delete the test entirely. |
| **4S.4** | TopBar v4 styling + `useTheme` toggle (Theme E) | `web/src/features/studio/panels/TopBar.tsx` | 4S.1 | +149/-44 | Unit test: theme toggle button click flips `data-theme` attr (or store value). Visual diff manually. |
| **4S.5** | Chat panel: history hydration + `setBlocks` (Theme C, slice 1 of 3) | `web/src/features/chat/store.ts`, `web/src/features/studio/panels/Chat/index.tsx` (history + composer only — defer markdown) | 4S.1 | ~150 | Unit test: mount `<ChatPanel>` with MSW returning `{blocks: […]}`; assert all messages render. Also test `setBlocks` action in store. |
| **4S.6** | Chat panel: markdown rendering (Theme C, slice 2 of 3) | `web/src/features/studio/panels/Chat/index.tsx` (assistant bubble), `web/src/styles/globals.css` (already done in 4S.1, just verify) | 4S.5 | ~80 | Render test: feed an assistant block with `**bold**` + a list; assert `<strong>` and `<li>` appear in the DOM. |
| **4S.7** | Chat panel: editorial visuals (Theme C, slice 3 of 3) — header chip, thinking-dots, type-aware bubbles | `web/src/features/studio/panels/Chat/index.tsx` | 4S.6 | ~150 | Render test variants per block type (`user`, `tool_use`, `thinking`, default). |
| **4S.8** | Preview panel rewrite (Theme D) — shell, custom transport, scrubber | `web/src/features/studio/panels/PreviewPanel.tsx` | 4S.1 | +455/-20 | Unit-test `<Scrubber>` standalone (pointer-down → onSeek called with correct progress). Integration test: tab switch, play/pause click toggles `playing` state. **Decision:** trim or implement `ref/compare` tabs (D5). |
| **4S.9** | Timeline restyle (Theme F) | `Timeline/index.tsx`, `Track.tsx`, `Clip.tsx` and existing `*.test.tsx` updates; **delete** `Playhead.tsx`/`Ruler.tsx` if dead (D6) | 4S.1 | +390/-91 | Tests already updated in WIP — verify they pass. Add a render test for the new `<Ruler>` tick spacing logic. |
| **4S.10** | Server: cover-image attach + carousel synthesise (Theme G server-side) | `src/server/api.ts` | — (orthogonal) | +60 | Server test: GET `/api/works` returns `coverImage` for a work with `output/*.png`; GET `/api/works/:id/carousel` returns synthesised payload for a 404 image-text work. Server test count goes 72→74. |
| **4S.11** | Frontend data adapters + WorksGrid covers (Theme G client-side) — **fix Analytics adapter for §3.4** | `web/src/queries/{analytics,trends,works}.ts`, `web/src/features/works/WorksGrid.tsx` + module CSS, `web/src/features/explore/TrendingPanel.tsx` | 4S.10 | +212/-39 | `analytics.test.ts` already exists (currently failing) — the fix is to make `adapt()` accept both flat and nested shapes. New unit tests for `parseChineseUnit` (`万`, `亿`, `k`, plain). New render test for `WorksGrid` cover priority. |
| **4S.12** | Editor shell unification + Filmstrip image bg + design mockup sync (Theme H) | `web/src/pages/Editor.tsx`, `web/src/features/editor/panels/Filmstrip.tsx`, `autoviral design/*` | 4S.1, 4S.5 | +35 + 56 + design churn | Add a render test for `<Filmstrip>` that an `image`-typed slide renders `background-image: url(...)`. Editor mount test optional. |

### Dependency graph

```
              ┌─────────────────────────┐
              │  4S.0  test harness fix │
              └────────────┬────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │  4S.1  globals.css+deps │  (foundation)
              └────────────┬────────────┘
                           │
       ┌──────────┬────────┼────────┬─────────┬────────┐
       ▼          ▼        ▼        ▼         ▼        ▼
     4S.2       4S.4     4S.5     4S.8     4S.9     4S.12 (Filmstrip)
   Asset Q     TopBar   Chat-1   Preview  Timeline    │
       │                  │                            │
       ▼                  ▼                            │
     4S.3              4S.6 (md)                       │
   Wire+drop              │                            │
   Tweaks                 ▼                            │
                       4S.7 (visuals) ─────────────────┘
                                                  
       ┌─────────────────────────┐    (orthogonal)
       │  4S.10  server adapters │
       └────────────┬────────────┘
                    ▼
       ┌─────────────────────────┐
       │  4S.11  client adapters │
       │  (fixes Analytics test) │
       └─────────────────────────┘
```

4S.10 + 4S.11 can run in parallel with everything else (no shared files with Studio panels). 4S.12 depends on both 4S.1 (CSS) and 4S.5 (Chat) because the Editor reshell mounts `<ChatPanel>`.

---

## 7. Risk Assessment

### R1 — `react-markdown@^10` peer-dep / SSR conflict

- **Probability:** Medium. v10 changed types and dropped some plugin chains.
- **Impact:** High if it blocks — markdown rendering is the headline UX of Theme C.
- **Mitigation:** Run `npm install` from a clean lockfile mirror in 4S.1; smoke-test the Chat page in dev before splitting C into 4S.5/6/7. If conflict appears, pin to `react-markdown@^9`.

### R2 — Analytics adapter contract uncertainty (production shape unknown)

- **Probability:** Medium. The audit cannot verify whether the live `/api/analytics/creator` returns the flat or nested shape. The WIP commit message is absent.
- **Impact:** Medium. Either the fixture is wrong (real backend changed and MSW didn't follow) or the adapter is wrong (defensive over-engineering).
- **Mitigation:** **Ask the user for clarification** during plan write-up. Cheapest fix is to make `adapt()` accept both: `const account = raw?.data?.account ?? (raw as any)?.account; if (!account) return null;`.

### R3 — Tweaks panel deletion vs preservation

- **Probability:** Low (it's a binary decision the controller can make).
- **Impact:** Medium. If we delete it but a Phase 5+ task needs the brightness/contrast/saturation flow as a side-drawer, we have to rebuild it.
- **Mitigation:** **Ask the user**: keep `Tweaks/` as dead code with the old test pointing at `<LayerSection>` directly, or delete entirely? Recommend keep — the components are isolated, total ~600 LoC, and they encapsulate the "filter sliders" affordance which Phase 4-5 likely re-uses.

### R4 — Editor `<SlidesNav>` removal silently breaks image-text editing

- **Probability:** Medium. No test covers the Editor shell.
- **Impact:** High for image-text users — no way to navigate slides without the filmstrip-only route.
- **Mitigation:** Verify the `<Filmstrip>` (bottom tray) provides equivalent slide-selection affordance. If not, restore `<SlidesNav>` either in left col (replace `<ChatPanel>`) or as a collapsible bar. Add an Editor render test as part of 4S.12.

### R5 — Carousel synthesise breaks the `PUT /api/works/:id/carousel` save flow

- **Probability:** Low. The synthesise function is read-only and only fires on `404 ENOENT`.
- **Impact:** Low. Even if a user loads a synthesised carousel, edits, and saves, the `PUT` handler accepts the same yaml shape and overwrites.
- **Mitigation:** Add a server test for the 404→synthesise path (4S.10). Manual smoke: open a legacy image-text work → confirm slides appear → save → confirm `output/composition.yaml` (or wherever) is written.

### R6 — Lock-file noise during code review

- **Probability:** High that the lock-file diff exceeds 1500 lines.
- **Impact:** Low — purely cosmetic.
- **Mitigation:** Bundle `package.json` + `package-lock.json` together in 4S.1's commit; reviewer skips lock diff by convention.

---

## 8. Acceptance Criteria

"Studio v4 WIP shipped" is achieved when **all** of the following hold:

### 8.1 Test green-bar
- `npx vitest --config web/vitest.config.ts run` reports **169 pass / 0 fail / 0 skip** (matches pre-WIP baseline; counts may go higher if new tests are added in 4S.2/5/6/7/8/9/10/11/12).
- `npx vitest --config vitest.config.ts run` (server): **72 pass / 1 skip** OR `74 pass / 1 skip` after 4S.10 adds two server-side tests (cover attach + carousel synthesise). Either is acceptable; the constraint is "no regressions".
- `tsc --noEmit -p tsconfig.json` exits 0.
- `tsc --noEmit -p web/tsconfig.json` (if separate) exits 0.

### 8.2 Working tree clean
- After the final task commit, `git status --porcelain` returns empty.
- All untracked files (`AssetSidebar/index.tsx`, `queries/assets.ts`) are committed under their respective tasks.
- No orphaned files: either Tweaks/SlidesNav/Playhead/Ruler are deleted OR they have a documented reason for living (commented in the deleting commit's message).

### 8.3 Manual smoke (controller-runnable, ~5 min)
1. `npm run dev` (web) + `npm run server`. Open `http://localhost:5173/`.
2. Works grid renders ≥1 work card with either an image cover, a video cover (hover to play), or a deterministic gradient fallback. **No identical-blue-gold gradient on every card.**
3. Click into a short-video work → Studio loads. Confirm: TopBar shows `Autoviral` italic + `Studio · v4.0`; theme toggle sun/moon flips; `<AssetSidebar>` on the right shows asset group chips and tiles; chat history loads on the left; preview canvas renders with custom transport bar; play/pause + scrubber drag all work.
4. Click into an image-text work → Editor loads. Confirm filmstrip shows actual slide backgrounds (image-typed slides no longer blank).
5. Open a legacy image-text work that has `output/*.png` but no saved carousel yaml → confirm carousel auto-loads with synthesised slides.
6. Send a message in the Studio chat: tool_use chip appears; assistant response renders markdown bullets and bold correctly; thinking dots animate while streaming.

### 8.4 Phase 2 acceptance §2.5 verifiability
- The Phase 2 plan's leak ("clicking 'Create asset' in the asset sidebar opens the dialog") becomes verifiable: with the sidebar in place, *either* the upload button is wired to a dialog (D4 fixed in a plan-tracked task) *or* the controller documents that the dialog is intentionally deferred to a later phase. Either way: the *acceptance text is no longer ambiguous about which UI element it refers to*.

### 8.5 Phase 4 unblock
- After the last task commit, `git diff main...HEAD` only contains v4-themed changes; no leftover Phase 3 follow-ups.
- Phase 4's planned target files (`Timeline/{Clip,Track,index}.tsx`) are in their post-v4 state, so Phase 4 author starts from this baseline.

---

## 9. Open Questions for the Controller

These should be answered before the TDD plan is written:

1. **Q1 — Analytics shape:** Does the production `/api/analytics/creator` return the **flat** legacy shape `{account, summary, …}` or the **nested** new shape `{configured, data: {account, …}}`? (Answer determines whether 4S.11 fixes the adapter or the MSW fixture.)
2. **Q2 — Tweaks panel fate:** Delete `web/src/features/studio/panels/Tweaks/` entirely, or preserve it as dead code with a standalone unit test?
3. **Q3 — `<SlidesNav>` fate:** Image-text Editor lost its slide nav. Is the Filmstrip-only navigation acceptable for Phase 4-5, or should `<SlidesNav>` be restored (perhaps as a collapsible left tray when chat is closed)?
4. **Q4 — AssetSidebar upload button:** Wire to a create-asset dialog now (and bring the dialog code into scope), or remove the button until Phase 5+ lands the dialog?
5. **Q5 — Preview tabs:** Implement `参考` / `对比` tabs now, or strip the unused `tab` state and ship preview-only?
6. **Q6 — Editor reshell:** Was embedding `<ChatPanel>` into the Editor an explicit design call, or scope creep from the Studio rewrite? If the latter, defer 4S.12's Editor changes to a separate phase.

---

## 10. Confidence Score (per-section)

| Section | Confidence | Rationale |
| --- | --- | --- |
| §1 Executive | High | Numbers verified by `git diff --stat` and vitest. |
| §2 Theme decomposition | High | Each theme traces to specific file:line refs. |
| §3 Test root-cause | High | Stack traces captured directly from vitest. |
| §4 Cross-task contracts | High | Read all signatures from source. |
| §5 Drifts | High for D1-D8 (file-checked); Medium for D9 (didn't run smoke); D10-D11 (low-coverage areas). |
| §6 Task decomposition | Medium-High | Order is dependency-correct; LoC estimates are by-eye but `git diff --stat` backs them. |
| §7 Risks | Medium | R1, R2, R4 hinge on info the audit could not gather. |
| §8 Acceptance | High | Numerics derived from current measurements. |
| §9 Open questions | High | Each maps to a §5 drift the audit could not auto-resolve. |

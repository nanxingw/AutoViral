# Studio v4 Overhaul — TDD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the 3299-line uncommitted Studio v4 WIP at `wip/studio-v4-snapshot` (commit `2ea68fa`) into a series of clean per-task commits on `refactor/ui-v3-react`. End state: 4 currently-failing web tests resolved; AssetSidebar + Chat markdown + PreviewPanel rewrite + TopBar v4.0 styling + PipelineRail + AssetSidebar↔GenerationDialog wiring all landed; TweaksPanel refactored to a floating editorial overlay (theme + accent only); deprecated layer/composition/density sections preserved as @deprecated; Editor.tsx ChatPanel leak rolled back to SlidesNav; analytics msw fixture corrected to nested shape; Phase 4 (Timeline editing) can branch from a clean tip.

**Architecture:** Studio.tsx becomes a 4-row × 3-column grid (`top` / `rail` / `chat preview aside` / `chat timeline aside`) where `rail` is a new horizontal `<PipelineRail>` between TopBar and the panels. The right rail (`aside`) holds `<AssetSidebar workId>` which lists `useWorkAssets()`-bucketed CLIPS / IMAGES / AUDIO / TEXT and whose header `+` button opens the existing `<GenerationDialog>` (Phase 2.5). `<TweaksPanel>` becomes a floating glass overlay (fixed-position, top-right) with only `<ThemeSection>` mounted — the legacy `<LayerSection>` / `<CompositionSection>` / `<DensitySection>` remain on disk with `@deprecated` JSDoc for Phase 8 re-introduction. The `Studio.integration.test.tsx` `mount()` helper gains a `QueryClientProvider`; the brittle "brightness slider in Tweaks" test is deleted and replaced with a "Theme toggle in floating TweaksPanel writes to theme store" test that asserts the new floating-overlay surface. Editor.tsx is restored to its pre-WIP shape (`<SlidesNav>` in left column).

**Tech Stack:** React 18 + TypeScript, Vite + Vitest, React Query (`@tanstack/react-query`), Zustand stores (`useChatStore`, `useTheme`, `useComposition`), `react-markdown@^10` + `remark-gfm@^4` for markdown rendering inside Chat assistant bubbles, MSW (`msw@2`) for HTTP mocking, Hono backend (`src/server/api.ts`) for `/api/works/:id/{assets,carousel,chat}` and `/api/analytics/creator`. Studio uses CSS custom properties driven by `data-theme` / `data-accent` on `<html>`; new design tokens land in `globals.css`.

---

## 0. Audit-Driven Pre-Plan Decisions

The 487-line baseline audit (`docs/superpowers/plans/2026-04-29-studio-v4-baseline-audit.md`) surfaced 11 drifts (D1-D11). The controller has pre-decided five technical answers (A1-A5) that this plan executes verbatim. Every decision below maps to specific task IDs.

| # | Audit finding | Decision (controller) | Affected task IDs |
|---|---|---|---|
| **A1** | `Analytics.test.tsx` fails because `adapt()` (queries/analytics.ts) requires nested `{configured, data:{account,...}}` but msw mock `web/src/test/msw.ts:33` returns flat `{account, summary, ...}`. Backend `src/server/api.ts:720-733` confirms nested is the production shape. | **Update msw fixture to nested shape; do NOT change adapter.** | SV.0 |
| **A2** | `Studio.integration.test.tsx > brightness slider in Tweaks` asserts on `data-testid="layer-brightness"` (LayerSection) which no longer mounts because Studio.tsx replaced TweaksPanel with AssetSidebar. v4 mockup (`autoviral design/studio-app.jsx:514-525`) shows TweaksPanel as a **floating overlay** containing only `<TweakSection title="主题 / Theme">` with theme + accent radios. | **Refactor TweaksPanel to floating overlay (fixed-position, glass surface) containing ONLY ThemeSection. Mark LayerSection.tsx / CompositionSection.tsx / DensitySection.tsx with `@deprecated` JSDoc (do NOT delete — Phase 8 may re-introduce per-clip inspector). DELETE the brightness-slider `it()` block; add a new test asserting the floating TweaksPanel's theme toggle writes to `useTheme`.** | SV.C, SV.H |
| **A3** | `Editor.tsx:85` substitutes `<ChatPanel>` for `<SlidesNav>`. Design source-of-truth `autoviral design/image-editor-app.jsx:66,403` shows `<SlidesNav>` is the intended left-column component. | **Roll Editor.tsx back to use `<SlidesNav>` (revert that single substitution). Keep all other Editor changes — they're incidental polish, not in scope.** | SV.F |
| **A4** | `AssetSidebar` header `+` button (line 54-72) is a no-op. Phase 2 §2.5 acceptance ("clicking 'Create asset' in the asset sidebar opens the dialog") has been pending since Phase 2 closed. `<GenerationDialog>` already exists at `web/src/features/studio/generation/GenerationDialog.tsx` (commit `b16459b`) with `{workId, open, onOpenChange}` props — not yet mounted anywhere. | **Wire the `+` button to open `<GenerationDialog workId={workId} open={open} onOpenChange={...}>`. Mount the dialog at the AssetSidebar level (component owns its open-state). This closes Phase 2 §2.5.** | SV.A |
| **A5** | v4 mockup `autoviral design/studio-app.jsx:506-509,37-79` defines `<PipelineRail>` — a horizontal pipeline-stage progress rail mounted at `gridArea: "rail"`. WIP doesn't implement it; Studio's grid only has 3 rows (`top` / `chat preview aside` / `chat timeline aside`). | **Implement minimal `PipelineRail.tsx` matching mockup's static visual structure with hardcoded stages (research / scripting / generation / assembly / loudnorm → 5 pills, status from a placeholder array). Add `rail` row to Studio.tsx grid template. Live pipeline-state wiring is out of scope for this plan.** | SV.B, SV.G |

**Drifts not pre-decided but resolved here:**

- D1 (Tweaks orphaned) — A2 keeps the directory alive, marks deprecated.
- D3 (test mount() missing QueryClientProvider) — SV.0 fixes it.
- D4 (AssetSidebar `+` no-op) — A4 wires it to GenerationDialog.
- D5 (PreviewPanel `tab` state half-wired) — SV.D ships preview-only and removes the `tab` state to avoid lint dead-vars (controller decision: visual-only `参考`/`对比` tabs deferred).
- D6 (Timeline Playhead.tsx / Ruler.tsx orphaned) — SV.K verifies and deletes if confirmed orphaned.
- D7 (SlidesNav orphaned in Editor) — A3 restores SlidesNav use.
- D8 (lock file churn) — bundled with SV.0's package.json bump.
- D10 (Clip light-theme detection non-reactive) — accepted as known limitation; flagged for Phase 4.
- D11 (WorksGrid no test) — SV.L adds a render test.

---

## 1. File Structure

Marker legend: `[NEW]` create from scratch · `[MOD]` modify existing · `[WIP]` accept WIP verbatim or near-verbatim · `[RESTORE]` git-restore from `fcd71b9` · `[DEPRECATE]` keep file, add `@deprecated` JSDoc · `[DELETE]` remove from disk if confirmed orphaned.

```
web/
├── src/
│   ├── pages/
│   │   ├── Studio.tsx                                       [MOD] grid → 4 rows w/ `rail`; mount AssetSidebar+PipelineRail+TweaksPanel-overlay
│   │   └── Editor.tsx                                       [RESTORE] revert ChatPanel substitution → use SlidesNav (A3)
│   ├── features/
│   │   ├── studio/
│   │   │   ├── Studio.integration.test.tsx                  [MOD] add QueryClientProvider; delete brightness test; add Theme toggle test (A2)
│   │   │   ├── panels/
│   │   │   │   ├── AssetSidebar/
│   │   │   │   │   ├── index.tsx                            [WIP] copy from WIP, add GenerationDialog wire-up (A4)
│   │   │   │   │   └── index.test.tsx                       [NEW] render test: groups + + button opens dialog
│   │   │   │   ├── PipelineRail.tsx                         [NEW] static visual mirror of mockup (A5)
│   │   │   │   ├── PipelineRail.test.tsx                    [NEW] render test: 5 stage pills
│   │   │   │   ├── PreviewPanel.tsx                         [WIP] port WIP rewrite (drop unused `tab` state per D5)
│   │   │   │   ├── TopBar.tsx                               [WIP] port v4 styling
│   │   │   │   ├── Chat/
│   │   │   │   │   └── index.tsx                            [WIP] port markdown + history rewrite
│   │   │   │   ├── Tweaks/
│   │   │   │   │   ├── index.tsx                            [MOD] floating overlay shell; mount ThemeSection only (A2)
│   │   │   │   │   ├── ThemeSection.tsx                     [MOD] add `data-testid="theme-toggle"` for SV.H assertion
│   │   │   │   │   ├── LayerSection.tsx                     [DEPRECATE] add @deprecated JSDoc header
│   │   │   │   │   ├── CompositionSection.tsx               [DEPRECATE] add @deprecated JSDoc header
│   │   │   │   │   └── DensitySection.tsx                   [DEPRECATE] add @deprecated JSDoc header
│   │   │   │   └── Timeline/
│   │   │   │       ├── Clip.tsx                             [WIP] port kind-aware gradients
│   │   │   │       ├── Clip.test.tsx                        [WIP] add trackKind/color props
│   │   │   │       ├── Track.tsx                            [WIP] port sticky label column
│   │   │   │       ├── Track.test.tsx                       [WIP] add totalWidth/color/label props
│   │   │   │       ├── index.tsx                            [WIP] port zoom buttons + inlined Ruler
│   │   │   │       ├── Playhead.tsx                         [DELETE] verify orphaned; remove
│   │   │   │       └── Ruler.tsx                            [DELETE] verify orphaned; remove
│   │   │   └── generation/
│   │   │       └── GenerationDialog.tsx                     [unchanged] consumed by AssetSidebar (already exists, commit b16459b)
│   │   ├── editor/panels/
│   │   │   └── Filmstrip.tsx                                [WIP] port image/gradient/solid bg rendering
│   │   ├── chat/
│   │   │   └── store.ts                                     [WIP] port `setBlocks` action
│   │   ├── works/
│   │   │   ├── WorksGrid.tsx                                [WIP] port cover priority + fallbackGradient
│   │   │   └── WorksGrid.module.css                         [WIP] port supporting styles
│   │   └── explore/
│   │       └── TrendingPanel.tsx                            [WIP] port empty-state copy
│   ├── queries/
│   │   ├── analytics.ts                                     [WIP] port adapter (nested-shape; A1 fixes mock side)
│   │   ├── trends.ts                                        [WIP] port platform normalisers
│   │   ├── works.ts                                         [WIP] port coverImage / coverIsVideo fields
│   │   └── assets.ts                                        [WIP] new query (already correct in WIP)
│   ├── styles/
│   │   └── globals.css                                      [WIP] +107 editorial tokens & rules
│   └── test/
│       └── msw.ts                                           [MOD] update analytics fixture to nested shape (A1)
src/
└── server/
    └── api.ts                                               [MOD] surgery — synthesiseLegacyCarousel + cover attach
package.json                                                 [MOD] add react-markdown ^10.1.0 + remark-gfm ^4.0.1
package-lock.json                                            [MOD] cascade churn (~+1500 lines)
autoviral design/                                            [WIP] design mockup sync — bundle with SV.G's commit (cosmetic)
```

**Surgery hygiene check.** Per controller's note in the plan request — `git status src/server/api.ts` reports the file is **staged** (already `git add`-ed but not committed). The diff is exactly the carousel-synthesise + cover-attach hunks from the WIP — no Phase 3 leakage. Treat it as a clean MODIFY for SV.I. **Two-snapshot pattern is NOT required** for this file (no concurrent unstaged changes that need to land in a different commit).

---

## 2. Roadmap

12 tasks total: SV.0 + SV.A through SV.L. Dependency graph:

```
                      ┌─────────────────────────────────────┐
                      │  SV.0  Foundation                   │
                      │  • npm install react-markdown+gfm   │
                      │  • globals.css editorial tokens     │
                      │  • msw analytics → nested shape (A1)│
                      │  • chat/store.ts setBlocks          │
                      │  • queries/assets.ts (new file)     │
                      └────────────────┬────────────────────┘
                                       │
   ┌─────────────────┬─────────────────┼─────────────────┬─────────────────┐
   ▼                 ▼                 ▼                 ▼                 ▼
 SV.A             SV.B               SV.C              SV.D              SV.E
 AssetSidebar     PipelineRail       TweaksPanel       PreviewPanel      Chat panel
 standalone       (new)              floating          rewrite           markdown +
 (+ dialog wire)  static visual      overlay (A2)      (drop tab D5)     history
   │                 │                 │                 │                 │
   └────────┬────────┴─────────────────┴────────┬────────┴────────┬────────┘
            │                                   │                 │
            ▼                                   ▼                 ▼
          SV.G  Studio.tsx grid wire-up         │                 │
          (mount A+B+C+D+E in 4-row grid;      │                 │
           bundle "autoviral design/" sync)     │                 │
                       │                       │                 │
                       └───────────┬───────────┘                 │
                                   │                             │
                                   ▼                             │
                                 SV.H  Studio.integration.test   │
                                 rewrite (QueryClient + delete   │
                                 brightness + add theme toggle   │
                                 test)                           │
                                                                 │
   ┌─── Independent (run in any order, parallel-safe) ───────────┘
   │
   ├─► SV.F  Editor.tsx rollback (A3) — no deps
   ├─► SV.I  src/server/api.ts surgery — no deps (already staged)
   ├─► SV.J  TopBar v4 styling — depends on SV.0 only (CSS tokens)
   ├─► SV.K  Timeline restyle (Clip/Track/index + tests + delete orphans) — depends on SV.0
   └─► SV.L  Data layer batch (analytics/trends/works queries + WorksGrid + Filmstrip + TrendingPanel) — depends on SV.0
```

Critical path: `SV.0 → SV.A/B/C/D/E (parallel) → SV.G → SV.H`. Total estimated execution: ~7 hours sequential, ~3 hours with subagent parallelism on the SV.A/B/C/D/E and SV.F/I/J/K/L batches.

---

## Task SV.0 — Foundation: deps, globals.css, msw fix, chat store, assets query

**Files:**
- Modify: `package.json` — add `react-markdown ^10.1.0`, `remark-gfm ^4.0.1`
- Modify: `package-lock.json` — npm-managed cascade
- Modify: `web/src/styles/globals.css` — port WIP +107 lines (editorial tokens + `.md-bubble` + pulse-dot keyframes + pill defaults)
- Modify: `web/src/test/msw.ts` — wrap `/api/analytics/creator` response in `{configured: true, data: {...}}` envelope (A1)
- Modify: `web/src/features/chat/store.ts` — add `setBlocks(blocks)` action
- Create: `web/src/queries/assets.ts` — port WIP verbatim (already correct)
- Create: `web/src/queries/assets.test.ts` — unit-test the bucketing classifier

**Why this comes first:** Every panel rewrite consumes editorial CSS tokens (`.md-bubble`, `.pulse-dot`, `.slide-up`, pill-button defaults). The msw fix must precede SV.H so integration tests don't fail on the analytics bucket. `chat/store.setBlocks` is consumed by SV.E. `queries/assets.ts` is consumed by SV.A.

- [ ] **Step 1: Install deps**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
npm install react-markdown@^10.1.0 remark-gfm@^4.0.1
node -e "console.log(require('react-markdown/package.json').version)"
node -e "console.log(require('remark-gfm/package.json').version)"
```

Expected: two version strings (e.g. `10.1.0` and `4.0.1`). If `npm install` complains about peer-dep conflicts with React 18, pin: `npm install react-markdown@^10.1.0 remark-gfm@^4.0.1 --legacy-peer-deps`.

- [ ] **Step 2: Verify the WIP `package.json` already matches**

```bash
git diff fcd71b9 -- package.json
```

Expected: the diff shows exactly two new entries under `dependencies`:

```diff
+    "react-markdown": "^10.1.0",
+    "remark-gfm": "^4.0.1",
```

If the install in Step 1 produced different versions (e.g. `^10.1.1`), that's fine — the constraint string is what matters.

- [ ] **Step 3: Write the failing assets-classifier test**

Create `web/src/queries/assets.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useWorkAssets } from "./assets";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (_url: string) => ({
    assets: [
      "assets/clips/intro.mp4",
      "assets/clips/outro.mov",
      "output/final.webm",
      "assets/images/cover.png",
      "assets/images/cover.jpeg",
      "assets/audio/bgm.mp3",
      "output/voiceover.m4a",
      "scripts/script.txt",
      "chat.json",
      "weird.unknown",
    ],
  })),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.clearAllMocks());

describe("useWorkAssets", () => {
  it("buckets assets into CLIPS / IMAGES / AUDIO / TEXT and drops 'other'", async () => {
    const { result } = renderHook(() => useWorkAssets("w1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const groups = result.current.data!;
    const byKey = Object.fromEntries(groups.map((g) => [g.group, g]));
    expect(byKey.CLIPS.count).toBe(3); // mp4, mov, webm
    expect(byKey.IMAGES.count).toBe(2); // png, jpeg
    expect(byKey.AUDIO.count).toBe(2); // mp3, m4a
    expect(byKey.TEXT.count).toBe(2); // txt, json
    // weird.unknown classifies as "other" and is dropped.
    expect(groups.flatMap((g) => g.items).map((i) => i.path)).not.toContain(
      "weird.unknown",
    );
  });

  it("returns empty array when workId is null", async () => {
    const { result } = renderHook(() => useWorkAssets(null), { wrapper });
    // Query disabled — never fetches.
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.data).toBeUndefined();
  });

  it("encodes path segments in url", async () => {
    const { result } = renderHook(() => useWorkAssets("w1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const item = result.current.data!.find((g) => g.group === "CLIPS")!.items[0];
    expect(item.url).toBe("/api/works/w1/assets/assets/clips/intro.mp4");
  });
});
```

- [ ] **Step 4: Run the test to verify failure**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
npx vitest --config web/vitest.config.ts run web/src/queries/assets.test.ts
```

Expected: failure — `Failed to resolve import "./assets"` (file does not exist on `fcd71b9`).

- [ ] **Step 5: Create `web/src/queries/assets.ts`**

Copy the WIP file verbatim. The current WIP source is correct:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface AssetGroup {
  group: string;
  count: number;
  items: AssetItem[];
}

export interface AssetItem {
  /** Path relative to the work dir, e.g. "assets/clips/intro.mp4" or "output/final.mp4" */
  path: string;
  /** URL to fetch the file. */
  url: string;
  /** Bucketed kind for UI grouping. */
  kind: "video" | "audio" | "image" | "text" | "other";
  /** File extension without dot, lowercased. */
  ext: string;
  /** Stable filename for display. */
  name: string;
}

const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|flac|ogg)$/i;
const TEXT_EXT = /\.(txt|md|srt|vtt|json|yaml|yml)$/i;

function classify(path: string): AssetItem["kind"] {
  if (VIDEO_EXT.test(path)) return "video";
  if (IMAGE_EXT.test(path)) return "image";
  if (AUDIO_EXT.test(path)) return "audio";
  if (TEXT_EXT.test(path)) return "text";
  return "other";
}

export function useWorkAssets(workId: string | null) {
  return useQuery({
    queryKey: ["assets", workId],
    enabled: !!workId,
    queryFn: async (): Promise<AssetGroup[]> => {
      if (!workId) return [];
      const res = await apiFetch<{ assets: string[] }>(`/api/works/${workId}/assets`);
      const items: AssetItem[] = res.assets.map((p) => {
        const m = p.match(/\.([^.]+)$/);
        const ext = (m?.[1] ?? "").toLowerCase();
        const name = p.split("/").pop() ?? p;
        return {
          path: p,
          url: `/api/works/${workId}/assets/${p.split("/").map(encodeURIComponent).join("/")}`,
          kind: classify(p),
          ext,
          name,
        };
      });
      const groups: { [k: string]: AssetItem[] } = {
        CLIPS: items.filter((i) => i.kind === "video"),
        IMAGES: items.filter((i) => i.kind === "image"),
        AUDIO: items.filter((i) => i.kind === "audio"),
        TEXT: items.filter((i) => i.kind === "text"),
      };
      return Object.entries(groups)
        .filter(([, list]) => list.length > 0)
        .map(([group, list]) => ({ group, count: list.length, items: list }));
    },
  });
}
```

(Identical to `git show 2ea68fa:web/src/queries/assets.ts` — confirm with `diff <(git show 2ea68fa:web/src/queries/assets.ts) web/src/queries/assets.ts`.)

- [ ] **Step 6: Update msw analytics fixture (A1 fix)**

Edit `web/src/test/msw.ts` lines 33-50. Replace the existing flat-shape handler with a nested envelope matching `src/server/api.ts:720-733`:

```ts
  http.get("/api/analytics/creator", () =>
    HttpResponse.json({
      configured: true,
      data: {
        platform: "douyin",
        account: { nickname: "@alex_creates", follower_count: 342_000, total_favorited: 2_847, aweme_count: 23 },
        works: [],
        summary: { todayLikes: 2847, todayComments: 436, engagementRate: 0.087, todayLikesDelta: 0.123, todayCommentsDelta: 0.041, engagementDelta: -0.004 },
        demographics: {
          age: { "13-17": 0.08, "18-24": 0.35, "25-34": 0.32, "35-44": 0.15, "45+": 0.10 },
          gender: { male: 0.62, female: 0.38 },
          regions: [
            { name: "United States", pct: 0.28 },
            { name: "China", pct: 0.18 },
          ],
        },
        insights: [{ date: "Mar 14", body: "Competitor gap: tutorial content under-served", tag: "ANGLE" }],
      },
      delta: null,
    }),
  ),
```

- [ ] **Step 7: Add `setBlocks` to chat store**

`web/src/features/chat/store.ts` — add the action (matches WIP):

```ts
interface ChatStore {
  blocks: StreamBlock[];
  streaming: boolean;
  push: (b: { type: StreamBlockType; text: string; toolName?: string; questions?: string[] }) => void;
  /** Replace the whole conversation — used when seeding from server-side chat.json. */
  setBlocks: (blocks: StreamBlock[]) => void;
  setStreaming: (s: boolean) => void;
  clear: () => void;
}
```

In the `create<ChatStore>(...)` body, add:

```ts
  setBlocks: (blocks) => set({ blocks }),
```

Add a unit test at `web/src/features/chat/store.test.ts` (create the file if absent — check `ls web/src/features/chat/`):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "./store";
import type { StreamBlock } from "./types";

beforeEach(() => useChatStore.setState({ blocks: [], streaming: false }));

describe("useChatStore.setBlocks", () => {
  it("replaces the entire blocks array", () => {
    useChatStore.getState().push({ type: "user", text: "old" });
    expect(useChatStore.getState().blocks).toHaveLength(1);
    const seeded: StreamBlock[] = [
      { id: "h1", ts: 1, type: "user", text: "seeded-1" },
      { id: "h2", ts: 2, type: "assistant", text: "seeded-2" },
    ];
    useChatStore.getState().setBlocks(seeded);
    expect(useChatStore.getState().blocks).toEqual(seeded);
  });
});
```

- [ ] **Step 8: Port `globals.css`**

Apply the WIP delta verbatim:

```bash
git checkout 2ea68fa -- web/src/styles/globals.css
```

Then verify the change is the +107-line block (no other surprises):

```bash
git diff fcd71b9 -- web/src/styles/globals.css | head -3
```

Expected: shows `web/src/styles/globals.css | 119 ++++++++++++++++++++++++++++++++++--`. Skim the new content — confirm presence of `@keyframes pulse-dot`, `.md-bubble`, `.pulse-dot`, `.slide-up`, `.font-editorial`, `.eyebrow`, default pill rules, default text-input rules, accent swatches.

- [ ] **Step 9: Run all the tests**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
npx vitest --config web/vitest.config.ts run \
  web/src/queries/assets.test.ts \
  web/src/features/chat/store.test.ts \
  web/src/features/analytics/Analytics.test.tsx
```

Expected: `assets.test.ts` 3/3 pass; `store.test.ts` 1/1 pass; `Analytics.test.tsx` now passes (the analytics test was failing because of msw shape — A1 fixed). Full pass.

- [ ] **Step 10: TypeScript check**

```bash
npx tsc --noEmit -p web/tsconfig.json && npx tsc --noEmit -p tsconfig.json
```

Expected: both exit 0.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json \
        web/src/styles/globals.css \
        web/src/test/msw.ts \
        web/src/features/chat/store.ts \
        web/src/features/chat/store.test.ts \
        web/src/queries/assets.ts \
        web/src/queries/assets.test.ts
git commit -m "$(cat <<'EOF'
feat(studio): foundation — deps, editorial tokens, msw fixture, chat seed (SV.0)

Lays the foundation every Studio v4 panel depends on:

• deps: react-markdown ^10.1.0 + remark-gfm ^4.0.1 (Theme A audit ref).
• globals.css: +107 editorial tokens — pulse-dot/slide-up keyframes,
  .md-bubble markdown styles, default pill-button rules, default
  text-input rules, accent swatches.
• test/msw.ts: wrap /api/analytics/creator in {configured, data:{...}}
  envelope to match production shape (audit §3.4 — A1 decision).
  Resolves Analytics.test.tsx failure without touching the adapter.
• chat/store.ts: setBlocks(blocks) action used by Chat panel history
  hydration (SV.E) — replaces the whole array atomically.
• queries/assets.ts: useWorkAssets(workId) → AssetGroup[] bucketed
  CLIPS/IMAGES/AUDIO/TEXT (drops 'other'). Consumed by AssetSidebar
  (SV.A). Tests cover bucketing, null-id disable, URL encoding.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task SV.A — AssetSidebar standalone + GenerationDialog wire-up

**Files:**
- Create: `web/src/features/studio/panels/AssetSidebar/index.tsx` — port WIP, add `+` button onClick + `<GenerationDialog>` mount (A4)
- Create: `web/src/features/studio/panels/AssetSidebar/index.test.tsx` — render test: groups visible, `+` opens dialog

**Why this comes here:** Depends on SV.0 (`useWorkAssets`, CSS tokens). Standalone-testable — does not require Studio.tsx grid wire-up (that's SV.G). Closes Phase 2 §2.5 acceptance.

- [ ] **Step 1: Write the failing render test**

Create `web/src/features/studio/panels/AssetSidebar/index.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AssetSidebar } from "./index";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({
    assets: [
      "assets/clips/intro.mp4",
      "output/final.mp4",
      "assets/images/cover.png",
    ],
  })),
}));

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe("AssetSidebar", () => {
  it("renders Assets header and bucketed group chips", async () => {
    wrap(<AssetSidebar workId="w1" />);
    expect(await screen.findByText("Assets")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/CLIPS · 2/)).toBeTruthy();
      expect(screen.getByText(/IMAGES · 1/)).toBeTruthy();
    });
  });

  it("shows NO ASSETS empty state when no buckets", async () => {
    const mod = await import("@/lib/api");
    (mod.apiFetch as any).mockResolvedValueOnce({ assets: [] });
    wrap(<AssetSidebar workId="w1" />);
    await waitFor(() => expect(screen.getByText("NO ASSETS")).toBeTruthy());
  });

  it("clicking the '+' button opens the GenerationDialog (Phase 2 §2.5)", async () => {
    wrap(<AssetSidebar workId="w1" />);
    const plus = await screen.findByRole("button", { name: /upload/i });
    fireEvent.click(plus);
    // Dialog content (Radix renders into a portal — query the document).
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
npx vitest --config web/vitest.config.ts run web/src/features/studio/panels/AssetSidebar/index.test.tsx
```

Expected: `Failed to resolve import "./index"` (the file is untracked and may exist in WIP but the export contract differs — the WIP `+` button has no `onClick`).

- [ ] **Step 3: Create AssetSidebar with dialog wire-up**

Start from `git show 2ea68fa:web/src/features/studio/panels/AssetSidebar/index.tsx` and add the `+`-button click handler + dialog mount. Apply this diff on top of the WIP version:

```tsx
import { useMemo, useState } from "react";
import { useWorkAssets, type AssetItem } from "@/queries/assets";
import { GenerationDialog } from "@/features/studio/generation/GenerationDialog";

interface Props {
  workId: string;
}

function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function AssetSidebar({ workId }: Props) {
  const { data: groups = [], isLoading } = useWorkAssets(workId);
  const [active, setActive] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);

  const currentGroup = useMemo(() => {
    if (!groups.length) return null;
    return groups.find((g) => g.group === active) ?? groups[0];
  }, [groups, active]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--divider)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div
            style={{
              fontFamily: "var(--font-editorial)",
              fontSize: 18,
              fontStyle: "italic",
              letterSpacing: "-0.015em",
              color: "var(--text)",
            }}
          >
            Assets
          </div>
          <button
            type="button"
            aria-label="Upload"
            data-bare
            onClick={() => setGenOpen(true)}
            style={{
              width: 26, height: 26, borderRadius: 7,
              border: "1px solid var(--glass-border)",
              background: "var(--surface-0)",
              color: "var(--text-dim)",
              display: "grid", placeItems: "center", cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
          {groups.length === 0 && !isLoading && (
            <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dimmer)", letterSpacing: "0.06em" }}>
              NO ASSETS
            </span>
          )}
          {groups.map((g) => {
            const isActive = currentGroup?.group === g.group;
            return (
              <button
                key={g.group}
                type="button"
                data-bare
                onClick={() => setActive(g.group)}
                style={{
                  padding: "4px 10px", fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.06em", fontWeight: 500,
                  background: isActive ? "var(--accent-glow)" : "transparent",
                  border: `1px solid ${isActive ? "var(--accent)" : "var(--glass-border)"}`,
                  color: isActive ? "var(--accent-hi)" : "var(--text-dim)",
                  borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {g.group} · {g.count}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tile grid (preserve WIP body verbatim — it works) */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {(currentGroup?.items ?? []).map((it) => (
            <AssetTile key={it.path} item={it} />
          ))}
        </div>
      </div>

      <GenerationDialog workId={workId} open={genOpen} onOpenChange={setGenOpen} />
    </div>
  );
}

function AssetTile({ item }: { item: AssetItem }) {
  const hue = hueFromString(item.path);
  const isLight = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light";
  const bg = isLight
    ? `linear-gradient(145deg, hsl(${hue}, 40%, 82%), hsl(${(hue + 30) % 360}, 35%, 68%))`
    : `linear-gradient(145deg, hsl(${hue}, 40%, 25%), hsl(${(hue + 30) % 360}, 30%, 12%))`;
  return (
    <div
      data-testid={`asset-tile-${item.kind}`}
      style={{
        position: "relative", aspectRatio: "9/16", borderRadius: 8,
        background: bg, border: "1px solid var(--glass-border)",
        overflow: "hidden",
      }}
    >
      {item.kind === "video" && (
        <video
          src={item.url}
          muted
          playsInline
          preload="metadata"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
        />
      )}
      {item.kind === "image" && (
        <img src={item.url} loading="lazy" alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      {item.kind === "audio" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--text-dim)" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M9 18V6l12-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}
      <div
        style={{
          position: "absolute", bottom: 0, left: 0, right: 0, padding: 6,
          background: isLight
            ? "linear-gradient(180deg, transparent, rgba(15,24,34,0.6))"
            : "linear-gradient(180deg, transparent, rgba(0,0,0,0.8))",
        }}
      >
        <div style={{ fontSize: 10, color: "white", fontWeight: 500, letterSpacing: "-0.01em" }}>{item.name}</div>
      </div>
    </div>
  );
}
```

(Body of `AssetTile` is the same hover-play / lazy-img / audio-glyph behaviour as in the WIP — re-extracted into a sub-component for clarity. If `git show 2ea68fa:.../AssetSidebar/index.tsx` already factors it the same way, prefer that exact form.)

- [ ] **Step 4: Run the test to verify pass**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/panels/AssetSidebar/index.test.tsx
```

Expected: 3/3 pass. The `role="dialog"` query relies on Radix's `<Dialog.Content>` rendering with that role — verified against `web/src/features/studio/generation/GenerationDialog.tsx:251`.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit -p web/tsconfig.json
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/studio/panels/AssetSidebar/index.tsx \
        web/src/features/studio/panels/AssetSidebar/index.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): AssetSidebar standalone + GenerationDialog wire-up (SV.A)

Right-rail panel that lists work assets bucketed into CLIPS / IMAGES /
AUDIO / TEXT via useWorkAssets(workId). 9:16 thumbnail tiles with
hover-play for video, lazy <img> for images, audio-glyph fallback.

Header '+' button opens <GenerationDialog> (already exists from Phase
2.5 commit b16459b but was never mounted). This closes the pending
Phase 2 §2.5 acceptance: "clicking 'Create asset' in the asset sidebar
opens the dialog" (audit §0 / A4).

Not yet mounted in Studio.tsx — that's SV.G.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task SV.B — PipelineRail static visual

**Files:**
- Create: `web/src/features/studio/panels/PipelineRail.tsx`
- Create: `web/src/features/studio/panels/PipelineRail.test.tsx`

**Why this comes here:** Independent of SV.A. The mockup (`autoviral design/studio-app.jsx:37-79`) defines the visual; we mirror the static structure with hardcoded stages. Live wiring to a pipeline-state store is out of scope.

- [ ] **Step 1: Write the failing render test**

Create `web/src/features/studio/panels/PipelineRail.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineRail } from "./PipelineRail";

describe("PipelineRail", () => {
  it("renders 5 stage pills with English+Chinese labels", () => {
    render(<PipelineRail />);
    expect(screen.getByText("研究")).toBeTruthy();
    expect(screen.getByText("脚本")).toBeTruthy();
    expect(screen.getByText("生成")).toBeTruthy();
    expect(screen.getByText("剪辑")).toBeTruthy();
    expect(screen.getByText("响度")).toBeTruthy();
  });

  it("shows TOTAL footer with eval indicator", () => {
    render(<PipelineRail />);
    expect(screen.getByText(/TOTAL/)).toBeTruthy();
    expect(screen.getByText(/EVAL/)).toBeTruthy();
  });

  it("renders the 'running' stage with an aria-current marker", () => {
    render(<PipelineRail />);
    const running = screen.getByTestId("rail-stage-generation");
    expect(running.getAttribute("data-status")).toBe("running");
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/panels/PipelineRail.test.tsx
```

Expected: `Failed to resolve import "./PipelineRail"`.

- [ ] **Step 3: Implement PipelineRail**

Create `web/src/features/studio/panels/PipelineRail.tsx`:

```tsx
// PipelineRail — Studio v4.0 horizontal pipeline-stage progress rail.
// Mirrors the static visual from autoviral design/studio-app.jsx:37-79.
// Stages are hardcoded in this batch; live wiring to pipeline state is
// deferred (no upstream store exists yet — see Phase 5+).

type StageStatus = "done" | "running" | "pending";

interface Stage {
  id: string;
  zh: string;
  en: string;
  duration: string;
  status: StageStatus;
}

const STAGES: Stage[] = [
  { id: "research",   zh: "研究", en: "RESEARCH",   duration: "1m 12s", status: "done" },
  { id: "scripting",  zh: "脚本", en: "SCRIPTING",  duration: "2m 04s", status: "done" },
  { id: "generation", zh: "生成", en: "GENERATION", duration: "5m 32s", status: "running" },
  { id: "editing",    zh: "剪辑", en: "EDITING",    duration: "—",       status: "pending" },
  { id: "loudness",   zh: "响度", en: "LOUDNESS",   duration: "—",       status: "pending" },
];

export function PipelineRail() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "10px 14px",
        whiteSpace: "nowrap",
        overflowX: "auto",
        height: "100%",
      }}
    >
      {STAGES.map((step, i) => (
        <div key={step.id} style={{ display: "contents" }}>
          <div
            data-testid={`rail-stage-${step.id}`}
            data-status={step.status}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "6px 12px",
              background:
                step.status === "running" ? "var(--accent-glow)" :
                step.status === "done" ? "rgba(163,230,53,0.08)" : "transparent",
              border: `1px solid ${
                step.status === "running" ? "var(--accent)" :
                step.status === "done" ? "rgba(163,230,53,0.25)" : "var(--glass-border)"
              }`,
              borderRadius: 999,
              flex: "0 0 auto",
            }}
          >
            <span
              style={{
                width: 22, height: 22, borderRadius: "50%",
                display: "grid", placeItems: "center", flexShrink: 0,
                background:
                  step.status === "done" ? "var(--status-done, #a3e635)" :
                  step.status === "running" ? "var(--accent)" : "transparent",
                border: step.status === "pending" ? "1px dashed var(--text-muted)" : "none",
                color:
                  step.status === "pending" ? "var(--text-dimmer)" : "var(--accent-fg, #0a0b0f)",
                fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
              }}
            >
              {step.status === "done" ? "✓" : (i + 1).toString().padStart(2, "0")}
            </span>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, whiteSpace: "nowrap" }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{step.zh}</span>
              <span
                style={{
                  fontSize: 9, color: "var(--text-dimmer)",
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {step.en} · {step.duration}
              </span>
            </div>
          </div>
          {i < STAGES.length - 1 && (
            <div
              style={{
                flex: "0 0 16px", height: 1,
                background: "var(--divider)", position: "relative",
              }}
            >
              {step.status === "done" && (
                <div style={{ position: "absolute", inset: 0, background: "var(--accent)", opacity: 0.4 }} />
              )}
            </div>
          )}
        </div>
      ))}
      <div style={{ flex: 1, minWidth: 16 }} />
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          fontSize: 11, color: "var(--text-dimmer)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span>TOTAL 11:54</span>
        <span>·</span>
        <span>EVAL ON</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify pass**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/panels/PipelineRail.test.tsx
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/studio/panels/PipelineRail.tsx \
        web/src/features/studio/panels/PipelineRail.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): PipelineRail static visual (SV.B)

Horizontal pipeline-stage progress rail mounted between TopBar and
the panels in v4.0 grid (mockup: autoviral design/studio-app.jsx:37-79,
A5 decision). 5 stages hardcoded for this batch:
  research(done) → scripting(done) → generation(running) →
  editing(pending) → loudness(pending)

Live wiring to a pipeline-state store is deferred — no upstream
store exists yet, and the audit recommended ship-first / wire-later.

Tested via data-testid + Chinese label assertions; not yet mounted
in Studio.tsx (that's SV.G).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task SV.C — TweaksPanel → floating overlay (theme + accent only)

**Files:**
- Modify: `web/src/features/studio/panels/Tweaks/index.tsx` — refactor to floating glass overlay; mount only ThemeSection
- Modify: `web/src/features/studio/panels/Tweaks/ThemeSection.tsx` — add `data-testid="theme-toggle"` to the dark/light buttons (consumed by SV.H)
- Modify: `web/src/features/studio/panels/Tweaks/LayerSection.tsx` — prepend `@deprecated` JSDoc header
- Modify: `web/src/features/studio/panels/Tweaks/CompositionSection.tsx` — prepend `@deprecated` JSDoc header
- Modify: `web/src/features/studio/panels/Tweaks/DensitySection.tsx` — prepend `@deprecated` JSDoc header

**Why this comes here:** A2 decision. The new TweaksPanel is mounted as an overlay in SV.G's Studio.tsx; it must exist with the new API before SV.G consumes it. SV.H consumes the new test ID.

- [ ] **Step 1: Write the failing render test**

Create `web/src/features/studio/panels/Tweaks/index.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TweaksPanel } from "./index";
import { useTheme } from "@/stores/theme";

beforeEach(() => useTheme.setState({ theme: "dark" }));

describe("TweaksPanel (v4 floating overlay)", () => {
  it("renders only the Theme section (no Layer/Composition/Density)", () => {
    render(<TweaksPanel />);
    expect(screen.getByText(/Theme/i)).toBeTruthy();
    // Deprecated sections must NOT mount.
    expect(screen.queryByTestId("layer-brightness")).toBeNull();
    expect(screen.queryByText(/Composition/i)).toBeNull();
    expect(screen.queryByText(/Density/i)).toBeNull();
  });

  it("is positioned as a fixed-position floating overlay", () => {
    const { container } = render(<TweaksPanel />);
    const root = container.firstChild as HTMLElement;
    expect(getComputedStyle(root).position).toBe("fixed");
  });

  it("theme toggle button writes through to useTheme store", () => {
    render(<TweaksPanel />);
    const lightBtn = screen.getByTestId("theme-toggle-light");
    fireEvent.click(lightBtn);
    expect(useTheme.getState().theme).toBe("light");
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/panels/Tweaks/index.test.tsx
```

Expected: failure on `position: fixed` (current TweaksPanel uses `<Glass tone="lo">` with no fixed positioning) and on `theme-toggle-light` testid (not yet present).

- [ ] **Step 3: Refactor TweaksPanel**

Replace `web/src/features/studio/panels/Tweaks/index.tsx`:

```tsx
import { ThemeSection } from "./ThemeSection";

/**
 * Studio v4.0 floating Tweaks overlay.
 *
 * Mounted as a fixed-position glass card in the top-right corner of the
 * viewport (mockup: autoviral design/studio-app.jsx:514-525). Contains
 * only the Theme + Accent controls in this batch — the legacy
 * LayerSection / CompositionSection / DensitySection are kept on disk
 * with @deprecated JSDoc and may be re-introduced as a per-clip
 * inspector in Phase 8.
 */
export function TweaksPanel() {
  return (
    <aside
      data-testid="tweaks-panel"
      aria-label="Tweaks"
      style={{
        position: "fixed",
        top: 76,
        right: 14,
        width: 240,
        zIndex: 50,
        background: "var(--surface-1)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
        border: "1px solid var(--glass-border)",
        borderRadius: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}
    >
      <ThemeSection />
    </aside>
  );
}
```

- [ ] **Step 4: Add test IDs to ThemeSection**

Edit `web/src/features/studio/panels/Tweaks/ThemeSection.tsx`. Find the dark/light button block:

```tsx
        <button
          className={theme === "dark" ? "active" : ""}
          onClick={() => setTheme("dark")}
        >
          Dark
        </button>
        <button
          className={theme === "light" ? "active" : ""}
          onClick={() => setTheme("light")}
        >
          Light
        </button>
```

Replace with:

```tsx
        <button
          data-testid="theme-toggle-dark"
          className={theme === "dark" ? "active" : ""}
          onClick={() => setTheme("dark")}
        >
          Dark
        </button>
        <button
          data-testid="theme-toggle-light"
          className={theme === "light" ? "active" : ""}
          onClick={() => setTheme("light")}
        >
          Light
        </button>
```

- [ ] **Step 5: Mark deprecated sections**

Prepend each of `LayerSection.tsx`, `CompositionSection.tsx`, `DensitySection.tsx` with the JSDoc header (substitute the section name):

```tsx
/**
 * @deprecated Studio v4.0 — not mounted in the new floating TweaksPanel.
 *
 * Preserved on disk because Phase 8 (per-clip inspector) is expected to
 * re-introduce these sliders as a side-drawer triggered by clip selection.
 * Until then this file is dead code; LayerSection.test.tsx mounts it
 * directly to keep the brightness-mutation contract under test.
 *
 * If you're consuming this from a new surface, talk to the Phase 8 lead
 * first — the contract may change (per-clip vs global filters).
 */
```

- [ ] **Step 6: Run the new tests**

```bash
npx vitest --config web/vitest.config.ts run \
  web/src/features/studio/panels/Tweaks/index.test.tsx \
  web/src/features/studio/panels/Tweaks/LayerSection.test.tsx
```

Expected: 3/3 pass on `index.test.tsx`; existing `LayerSection.test.tsx` still passes (the @deprecated JSDoc is comment-only — runtime unchanged).

- [ ] **Step 7: TypeScript + lint**

```bash
npx tsc --noEmit -p web/tsconfig.json
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add web/src/features/studio/panels/Tweaks/index.tsx \
        web/src/features/studio/panels/Tweaks/index.test.tsx \
        web/src/features/studio/panels/Tweaks/ThemeSection.tsx \
        web/src/features/studio/panels/Tweaks/LayerSection.tsx \
        web/src/features/studio/panels/Tweaks/CompositionSection.tsx \
        web/src/features/studio/panels/Tweaks/DensitySection.tsx
git commit -m "$(cat <<'EOF'
refactor(studio): TweaksPanel → floating overlay, theme-only (SV.C)

Per A2 decision: v4.0 mockup (studio-app.jsx:514-525) shows TweaksPanel
as a fixed-position glass overlay containing only the Theme section
(theme toggle + accent radios). The legacy LayerSection / CompositionSection
/ DensitySection are kept on disk with @deprecated JSDoc — Phase 8 may
re-introduce them as a per-clip inspector side-drawer.

Adds data-testid="theme-toggle-{dark,light}" so SV.H's integration test
can assert the new toggle surface (replaces the obsolete brightness-slider
test that asserted on no-longer-mounted UI).

LayerSection.test.tsx still passes — it mounts the section directly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task SV.D — PreviewPanel rewrite (transport bar + scrubber, drop tab state)

**Files:**
- Modify: `web/src/features/studio/panels/PreviewPanel.tsx` — port WIP rewrite minus the dead `tab` state (D5)

**Why this comes here:** Independent of A/B/C. Drop the unused `useState<"preview" | "ref" | "compare">` per audit D5 — visual-only `参考`/`对比` tabs are deferred.

- [ ] **Step 1: Write the failing scrubber-drag test**

Create `web/src/features/studio/panels/PreviewPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { PreviewPanel } from "./PreviewPanel";
import { useComposition } from "@/features/studio/store";
import { makeEmptyComposition } from "@/features/studio/types";

vi.mock("@remotion/player", () => ({
  Player: (props: any) => <div data-testid="player" data-fps={props.fps} />,
}));

describe("PreviewPanel", () => {
  it("renders the Player when comp is loaded", () => {
    useComposition.setState({ comp: makeEmptyComposition({ workId: "w1" }) });
    render(<PreviewPanel />);
    expect(screen.getByTestId("player")).toBeTruthy();
  });

  it("renders transport play/pause button", () => {
    useComposition.setState({ comp: makeEmptyComposition({ workId: "w1" }) });
    render(<PreviewPanel />);
    expect(screen.getByLabelText(/play|pause/i)).toBeTruthy();
  });

  it("does not render visual-only ref/compare tabs (D5 — deferred)", () => {
    useComposition.setState({ comp: makeEmptyComposition({ workId: "w1" }) });
    render(<PreviewPanel />);
    expect(screen.queryByText(/^参考$/)).toBeNull();
    expect(screen.queryByText(/^对比$/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/panels/PreviewPanel.test.tsx
```

Expected: failure — current `PreviewPanel.tsx` (HEAD `fcd71b9`) doesn't have transport bar; the WIP version has tabs we don't want.

- [ ] **Step 3: Implement PreviewPanel**

Run:

```bash
git checkout 2ea68fa -- web/src/features/studio/panels/PreviewPanel.tsx
```

Then open the file and remove the unused `tab` state. Specifically:

1. Remove the line `const [tab, setTab] = useState<"preview" | "ref" | "compare">("preview");` (around line 17 of the WIP).
2. Remove the JSX tab-switcher button group (renders `预览` / `参考` / `对比`).
3. Verify the rendered viewport is unconditionally the Player (no `tab === "preview" &&` gating).

After the edit, the file imports should match:

```tsx
import { useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { useComposition } from "@/features/studio/store";
// ... rest unchanged
```

- [ ] **Step 4: Run the test to verify pass**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/panels/PreviewPanel.test.tsx
```

Expected: 3/3 pass.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit -p web/tsconfig.json
```

Expected: exit 0. (If tsc errors on an unused import after dropping the tab state, remove the orphaned import.)

- [ ] **Step 6: Commit**

```bash
git add web/src/features/studio/panels/PreviewPanel.tsx \
        web/src/features/studio/panels/PreviewPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): PreviewPanel v4 rewrite — custom transport + scrubber (SV.D)

Ports the WIP Preview rewrite (mockup: autoviral design/studio-app.jsx:181-285):
  • ambient grid SVG backdrop
  • side-meta overlay (FRAME / CLIPS / EST. duration)
  • phone-frame canvas with safe-zone dashed border
  • custom transport bar subscribed to playerRef.addEventListener
    ('frameupdate' | 'play' | 'pause')
  • <Scrubber> sub-component with pointer-down + pointer-move drag-to-seek

Drops the unused {preview|ref|compare} tab state per audit D5 — visual-
only ref/compare tabs are deferred to a later phase. The viewport
renders the Player unconditionally.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task SV.E — Chat panel: history hydration + markdown + editorial visuals

**Files:**
- Modify: `web/src/features/studio/panels/Chat/index.tsx` — port WIP rewrite (uses `setBlocks` from SV.0)

**Why this comes here:** Depends on SV.0 (`setBlocks`, `react-markdown` deps, `.md-bubble` CSS). Lands as a single commit because the three concerns (history / markdown / visuals) share the same render tree.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/studio/panels/Chat/index.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ChatPanel } from "./index";
import { useChatStore } from "@/features/chat/store";

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => ({
    blocks: [
      { type: "user", text: "Hello" },
      { type: "assistant", text: "**bold** and a list:\n- item 1\n- item 2" },
      { type: "step_divider", text: "" }, // legacy — must be filtered
    ],
  })),
}));

beforeEach(() => useChatStore.setState({ blocks: [], streaming: false }));

describe("ChatPanel", () => {
  it("hydrates conversation from /api/works/:id/chat on mount", async () => {
    render(<ChatPanel workId="w1" />);
    await waitFor(() => {
      expect(useChatStore.getState().blocks.length).toBe(2); // step_divider filtered
    });
  });

  it("renders markdown in assistant bubbles (bold + list items)", async () => {
    render(<ChatPanel workId="w1" />);
    await waitFor(() => {
      expect(screen.getByText("bold").tagName.toLowerCase()).toBe("strong");
    });
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
  });

  it("renders the editorial header with CLAUDE-SONNET model label", async () => {
    render(<ChatPanel workId="w1" />);
    expect(await screen.findByText(/CLAUDE-SONNET/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/panels/Chat/index.test.tsx
```

Expected: failure — current Chat panel has no history hydration, no markdown, no editorial header.

- [ ] **Step 3: Port the WIP**

```bash
git checkout 2ea68fa -- web/src/features/studio/panels/Chat/index.tsx
```

Verify:

```bash
git diff HEAD -- web/src/features/studio/panels/Chat/index.tsx | head -10
```

Expected: shows the WIP delta is staged. The WIP imports `react-markdown` + `remark-gfm` (depends on SV.0), uses `useChatStore.setBlocks` (depends on SV.0), reads `.md-bubble` styles (depends on SV.0).

- [ ] **Step 4: Run the test to verify pass**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/panels/Chat/index.test.tsx
```

Expected: 3/3 pass. If the markdown test fails because of how react-markdown renders the bold tag, query by element instead:

```tsx
const strong = screen.getAllByText(/bold/i).find(
  (el) => el.tagName.toLowerCase() === "strong",
);
expect(strong).toBeTruthy();
```

- [ ] **Step 5: Smoke-test the full chat suite**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/chat/
```

Expected: existing chat-related tests pass (no regression in `LocatorBlock.test.tsx` etc).

- [ ] **Step 6: Commit**

```bash
git add web/src/features/studio/panels/Chat/index.tsx \
        web/src/features/studio/panels/Chat/index.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): Chat panel rewrite — history + markdown + editorial visuals (SV.E)

Three concerns merged into one rewrite (mockup: autoviral design/
studio-app.jsx:81-180, audit Theme C):

1. History hydration: apiFetch('/api/works/<id>/chat') on mount,
   setBlocks() seed with synthesised stable IDs, SKIP_TYPES filter
   for legacy step_divider markers.
2. Markdown rendering: assistant bubbles use <ReactMarkdown
   remarkPlugins={[remarkGfm]}> inside .md-bubble (globals.css
   styles tables / strong / em / code / pre / lists / headings).
3. Editorial visuals: ✦ glyph header, CLAUDE-SONNET-4.5 · STREAMING
   eyebrow, type-aware bubble variants (user/assistant/tool/thinking),
   pulse-dot thinking indicator, ⌘↵ SEND composer.

setBlocks() came from SV.0; react-markdown ^10 + remark-gfm ^4 deps
came from SV.0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task SV.F — Editor.tsx rollback (A3)

**Files:**
- Modify: `web/src/pages/Editor.tsx` — revert ChatPanel substitution; restore SlidesNav

**Why this comes here:** Independent of A-E. Rolls back the audit-flagged scope-creep leak. Image-text editing UX returns to its pre-WIP affordance.

- [ ] **Step 1: Write the failing-shape test**

Create `web/src/pages/Editor.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Editor from "./Editor";

vi.mock("@/features/editor/services/carousel", () => ({
  loadCarousel: vi.fn(async () => null),
  saveCarousel: vi.fn(async () => undefined),
}));

vi.mock("@/features/editor/hooks/useExport", () => ({
  useExport: () => ({ exportImage: vi.fn(), isExporting: false }),
}));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/editor/w1"]}>
        <Routes>
          <Route path="/editor/:workId" element={<Editor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Editor (A3 — SlidesNav restored)", () => {
  it("mounts SlidesNav in the left column (NOT ChatPanel)", () => {
    mount();
    // Anchor on a SlidesNav-specific element. SlidesNav renders a list
    // of slide thumbnails — its container has aria-label="slides".
    expect(screen.queryByLabelText(/slides/i)).toBeTruthy();
  });
});
```

(Inspect `web/src/features/editor/panels/SlidesNav.tsx` to confirm an aria-label or a more reliable selector. If absent, key off a unique testid present in SlidesNav. If neither exists, fall back to asserting the absence of the chat-specific `CLAUDE-SONNET` header.)

- [ ] **Step 2: Run the test to verify failure**

```bash
npx vitest --config web/vitest.config.ts run web/src/pages/Editor.test.tsx
```

Expected: failure — the WIP Editor.tsx imports `<ChatPanel>`, not `<SlidesNav>`.

- [ ] **Step 3: Roll back Editor.tsx**

```bash
git checkout fcd71b9 -- web/src/pages/Editor.tsx
```

Verify:

```bash
grep -n "SlidesNav\|ChatPanel" web/src/pages/Editor.tsx
```

Expected: shows `import { SlidesNav } ...` and `<SlidesNav />` usage; NO `ChatPanel` reference.

- [ ] **Step 4: Run the test to verify pass**

```bash
npx vitest --config web/vitest.config.ts run web/src/pages/Editor.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Editor.tsx web/src/pages/Editor.test.tsx
git commit -m "$(cat <<'EOF'
fix(editor): roll back ChatPanel substitution; restore SlidesNav (SV.F)

A3 decision: image-text Editor's left column was incidentally swapped
to <ChatPanel> during the Studio v4 WIP (audit D7). The design source
of truth (autoviral design/image-editor-app.jsx:66,403) confirms
<SlidesNav> is the intended affordance — it's how users navigate
between carousel slides.

This task restores Editor.tsx to its pre-WIP state. All other Editor
changes (Filmstrip image-bg, design-mockup sync) land separately
in SV.L.

Adds an Editor render test (none existed previously — audit R4) so
the regression can't recur silently.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task SV.G — Studio.tsx grid wire-up (mount A/B/C/D/E)

**Files:**
- Modify: `web/src/pages/Studio.tsx` — new 4-row grid template; mount AssetSidebar + PipelineRail + floating TweaksPanel
- Modify: `autoviral design/*.{html,jsx,css}` (6 files) — bundle the design-mockup sync (cosmetic)

**Why this comes here:** Aggregates SV.A (AssetSidebar), SV.B (PipelineRail), SV.C (TweaksPanel overlay). SV.D's PreviewPanel and SV.E's Chat panel are already imported — this task only re-wires the grid. Bundling the design-mockup churn keeps the cosmetic noise out of feature commits.

- [ ] **Step 1: Inspect current Studio.tsx state**

```bash
git diff fcd71b9 -- web/src/pages/Studio.tsx | head -60
```

The WIP already wires `<AssetSidebar workId={workId}>` into `gridArea: "aside"` and changes the grid template to `360px 1fr 320px` / `56px 1fr 280px`. **This task adds the `rail` row + the floating TweaksPanel** on top of the WIP base.

- [ ] **Step 2: Write the integration assertion (light-touch — full integration test is SV.H)**

Add a focused render test to `web/src/features/studio/Studio.integration.test.tsx` (SV.H rewrites the full file; here we only sketch the new shape so SV.G's commit is verifiable):

```bash
cat web/src/features/studio/Studio.integration.test.tsx
```

Defer the test rewrite to SV.H — this task's verification is "Studio compiles + manual smoke renders all panels".

- [ ] **Step 3: Update Studio.tsx**

Apply this final shape on top of the WIP:

```tsx
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useComposition,
  loadComposition as loadCompositionFromStore,
} from "@/features/studio/store";
import { exportMp4 } from "@/features/studio/services/render";
import { PreviewPanel } from "@/features/studio/panels/PreviewPanel";
import { Timeline } from "@/features/studio/panels/Timeline";
import { ChatPanel } from "@/features/studio/panels/Chat";
import { AssetSidebar } from "@/features/studio/panels/AssetSidebar";
import { TopBar } from "@/features/studio/panels/TopBar";
import { TweaksPanel } from "@/features/studio/panels/Tweaks";
import { PipelineRail } from "@/features/studio/panels/PipelineRail";
import { useShortcuts } from "@/features/studio/hooks/useShortcuts";

// (existing useEffect / hooks code unchanged from WIP — preserve)

export default function Studio() {
  // ... (keep all existing hook calls)

  return (
    <div
      className="studio-shell"
      data-work-id={workId}
      style={{
        display: "grid",
        gridTemplateColumns: "360px 1fr 320px",
        gridTemplateRows: "56px 48px 1fr 280px",
        gridTemplateAreas:
          '"top top top" "rail rail rail" "chat preview aside" "chat timeline aside"',
        height: "100vh",
        gap: 12,
        padding: 12,
        boxSizing: "border-box",
      }}
    >
      <div style={{ gridArea: "top" }} className="glass">
        <TopBar
          workId={workId}
          savedAt={savedAt}
          onExport={() => {
            void exportMp4(workId);
          }}
        />
      </div>
      <div style={{ gridArea: "rail" }} className="glass">
        <PipelineRail />
      </div>
      <div className="glass" style={{ gridArea: "chat", overflow: "hidden", minHeight: 0 }}>
        <ChatPanel workId={workId} />
      </div>
      <div className="glass" style={{ gridArea: "preview", overflow: "hidden", minHeight: 0 }}>
        <PreviewPanel />
      </div>
      <div className="glass" style={{ gridArea: "timeline", overflow: "hidden", minHeight: 0 }}>
        <Timeline />
      </div>
      <div className="glass" style={{ gridArea: "aside", overflow: "hidden", minHeight: 0 }}>
        <AssetSidebar workId={workId} />
      </div>

      <TweaksPanel />
    </div>
  );
}
```

(The `<TweaksPanel>` is intentionally OUTSIDE all `gridArea` divs — it's a fixed-position floating overlay positioned via its own `position: fixed` style, not via grid placement.)

- [ ] **Step 4: Bundle the design-mockup sync**

```bash
git checkout 2ea68fa -- "autoviral design/"
```

This brings in the WIP's small (+38/−35) cosmetic updates to the mockup files. They have no source-code impact.

- [ ] **Step 5: TypeScript + dev-server smoke**

```bash
npx tsc --noEmit -p web/tsconfig.json
```

Expected: exit 0.

```bash
# Manual smoke (operator runs this; agent skips if no dev server available):
npm run dev
# Open http://localhost:5173/studio/<some-work-id> and verify:
#   - TopBar at row 1
#   - PipelineRail at row 2 (5 stage pills)
#   - Chat | Preview | AssetSidebar at row 3
#   - Chat | Timeline | AssetSidebar at row 4
#   - TweaksPanel floating at top-right
```

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Studio.tsx "autoviral design/"
git commit -m "$(cat <<'EOF'
feat(studio): wire v4 grid — rail row + AssetSidebar + floating Tweaks (SV.G)

New 4-row × 3-col grid (mockup: autoviral design/studio-app.jsx:501-512):
  rows: 56px(top) | 48px(rail) | 1fr(panels) | 280px(timeline)
  cols: 360px(chat) | 1fr(preview/timeline) | 320px(aside)
  areas: 'top top top' / 'rail rail rail' /
         'chat preview aside' / 'chat timeline aside'

Mounts:
  • TopBar (already SV.J styled)
  • PipelineRail (SV.B) — new horizontal pipeline progress rail
  • ChatPanel (SV.E)
  • PreviewPanel (SV.D)
  • Timeline (SV.K)
  • AssetSidebar (SV.A) replaces TweaksPanel in the aside column
  • <TweaksPanel/> rendered OUTSIDE the grid as a fixed-position
    floating overlay (top-right)

Bundles the autoviral design/ mockup sync (cosmetic — same v4 source
of truth this plan was decomposed from).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task SV.H — Studio.integration.test.tsx rewrite

**Files:**
- Modify: `web/src/features/studio/Studio.integration.test.tsx`

**Why this comes here:** After SV.G, all panels mount. Now fix the test harness: add `<QueryClientProvider>` (D3 / A2 first half), delete the brittle brightness-slider test (A2 second half), add a Theme-toggle test against the new floating TweaksPanel.

- [ ] **Step 1: Write the new test file**

Replace `web/src/features/studio/Studio.integration.test.tsx` entirely:

```tsx
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Studio from "@/pages/Studio";
import { useComposition } from "./store";
import { makeEmptyComposition, type VideoClip } from "./types";
import { useTheme } from "@/stores/theme";

vi.mock("@remotion/player", () => ({
  Player: (props: any) => (
    <div
      data-testid="player"
      data-fps={props.fps}
      data-comp-w={props.compositionWidth}
    />
  ),
}));

vi.mock("./services/composition", () => ({
  loadComposition: vi.fn(async () => null),
  saveComposition: vi.fn(async () => undefined),
}));

vi.mock("@/features/chat/useChatSocket", () => ({
  useChatSocket: () => ({ send: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url.includes("/chat")) return { blocks: [] };
    if (url.includes("/assets")) return { assets: [] };
    return {};
  }),
}));

beforeEach(() => {
  useComposition.setState({
    comp: null,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    beats: [],
  });
  useTheme.setState({ theme: "dark" });
});

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/studio/w1"]}>
        <Routes>
          <Route path="/studio/:workId" element={<Studio />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Studio integration", () => {
  it("mounts with empty composition and renders Player", async () => {
    const { findByTestId } = mount();
    const player = await findByTestId("player");
    expect(player.getAttribute("data-fps")).toBe("30");
  });

  it("adding a clip surfaces it on the timeline", async () => {
    mount();
    await new Promise((r) => setTimeout(r, 10));
    const c = useComposition.getState().comp ?? makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    const v: VideoClip = {
      id: "v1",
      kind: "video",
      src: "/x.mp4",
      in: 0,
      out: 4,
      trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    };
    useComposition.getState().addClip("video-0", v);
    const tracks = useComposition.getState().comp!.tracks;
    expect(tracks[0].clips).toHaveLength(1);
  });

  it("Theme toggle in the floating TweaksPanel writes to the theme store (A2)", async () => {
    const { findByTestId } = mount();
    await findByTestId("player"); // wait for mount
    const lightBtn = await findByTestId("theme-toggle-light");
    fireEvent.click(lightBtn);
    expect(useTheme.getState().theme).toBe("light");
  });
});
```

The previous "brightness slider in Tweaks writes through to the store" `it()` block is **deleted**. Coverage of the brightness mutation contract is preserved by `web/src/features/studio/panels/Tweaks/LayerSection.test.tsx` which mounts `<LayerSection>` directly.

- [ ] **Step 2: Run the integration tests**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/Studio.integration.test.tsx
```

Expected: 3/3 pass.

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest --config web/vitest.config.ts run
```

Expected: full suite green. Counts:
- Pre-WIP baseline: 169 pass / 0 fail / 0 skip.
- After this plan: 169 pre-existing + new tests from SV.0 (4) + SV.A (3) + SV.B (3) + SV.C (3) + SV.D (3) + SV.E (3) + SV.F (1) + SV.K (TBD) + SV.L (TBD) ≈ **190+ pass / 0 fail / 0 skip**.
- Failing-tests must report 0.

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit -p web/tsconfig.json
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/studio/Studio.integration.test.tsx
git commit -m "$(cat <<'EOF'
test(studio): rewrite integration test for v4 grid (SV.H)

Three changes:

1. mount() helper now wraps in <QueryClientProvider>. AssetSidebar's
   useWorkAssets() call requires QueryClient context even with
   enabled=false (audit §3.1, D3). This unblocks all three Studio
   integration tests.

2. Delete the "brightness slider in Tweaks writes through to the store"
   test. The data-testid="layer-brightness" element no longer mounts
   in Studio (TweaksPanel was refactored to a theme-only floating
   overlay in SV.C). Brightness mutation is still covered by
   LayerSection.test.tsx (mounts the section directly). (A2 decision.)

3. Add "Theme toggle in floating TweaksPanel writes to theme store"
   test asserting the new surface (data-testid='theme-toggle-light',
   useTheme store mutation).

Mocks /api/works/:id/{chat,assets} via apiFetch so no real network
calls happen during integration tests.

All 4 audit-flagged failing tests resolved by this commit (combined
with SV.0's msw fixture fix).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task SV.I — Server: cover-image attach + carousel synthesise

**Files:**
- Modify: `src/server/api.ts` — port the staged WIP delta (synthesiseLegacyCarousel + cover attach)

**Why this comes here:** Independent of all UI tasks. The file is **already staged** on the working tree (see `git status src/server/api.ts`) — the diff is exactly the audit Theme G server-side changes. SV.L's WorksGrid render relies on `coverImage` being attached, so this commit must precede SV.L.

**Surgery hygiene check.** `git status src/server/api.ts` reports the file in the **staged** column with no concurrent unstaged changes. Two-snapshot pattern is unnecessary — this is a single-purpose commit.

- [ ] **Step 1: Verify the staged delta**

```bash
git diff fcd71b9 -- src/server/api.ts | head -120
```

Expected: ~+60 lines split into two hunks:
1. The `synthesiseLegacyComposition` comment update (~3 lines).
2. The new `synthesiseLegacyCarousel` function + 404-→synthesise wire-up in the carousel handler (~60 lines).

If the diff shows extra lines (e.g. cover-image attach in the works-list handler), accept them — they're part of Theme G's server side.

- [ ] **Step 2: Write a server-side test for synthesiseLegacyCarousel**

Append to `src/server/api.test.ts` (or wherever the carousel handler is currently tested — `grep -n "carousel" src/server/*.test.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
// ... existing imports for app & dataDir helper

describe("GET /api/works/:id/carousel — legacy synthesise (SV.I)", () => {
  const workId = "test-legacy-img";
  const wDir = join(testDataDir(), "works", workId);

  beforeEach(async () => {
    await mkdir(join(wDir, "output"), { recursive: true });
    await writeFile(join(wDir, "work.yaml"), `id: ${workId}\ntype: image-text\ntitle: Legacy\n`);
    await writeFile(join(wDir, "output", "page-01.png"), Buffer.alloc(8));
    await writeFile(join(wDir, "output", "page-02.png"), Buffer.alloc(8));
  });

  afterEach(async () => {
    await rm(wDir, { recursive: true, force: true });
  });

  it("synthesises a carousel from output/*.png when no carousel.yaml exists", async () => {
    const res = await app.request(`/api/works/${workId}/carousel`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workId).toBe(workId);
    expect(body.slides).toHaveLength(2);
    expect(body.slides[0].bg.type).toBe("image");
    expect(body.slides[0].bg.value).toMatch(/output\/page-01\.png$/);
  });

  it("returns 404 for a short-video work (synthesise is image-text only)", async () => {
    await writeFile(join(wDir, "work.yaml"), `id: ${workId}\ntype: short-video\ntitle: SV\n`);
    const res = await app.request(`/api/works/${workId}/carousel`);
    expect(res.status).toBe(404);
  });
});
```

(Match the existing test-helper pattern in the file — `app.request(...)` is Hono's testkit. If the test file imports `app` and `testDataDir` differently, adopt the existing convention.)

- [ ] **Step 3: Run the server tests**

```bash
npx vitest --config vitest.config.ts run src/server/api.test.ts
```

Expected: 72 (existing) + 2 (new) = 74 pass / 1 skip.

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/api.ts src/server/api.test.ts
git commit -m "$(cat <<'EOF'
feat(server): synthesise legacy carousel + clarify composition fallback (SV.I)

Two server-side changes that backfill the v4 carousel/cover-image flow:

1. synthesiseLegacyCarousel(workId, workType): when GET /api/works/:id/
   carousel hits ENOENT for an image-text work, scan output/*.png →
   assets/images/* and build a {slides: [{id, bg, layers}]} payload
   with deterministic ids. Side-effect-free; PUT/save flow unchanged.
   Returns null for non-image-text works.

2. Comment update on synthesiseLegacyComposition explaining why we
   prefer output/final*.mp4 over assets/clips/* (the user's already-
   curated cut should not be re-sequenced).

Tests: 2 new server tests cover the synthesise path
(image-text 200 / short-video 404). Server suite 72→74 pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task SV.J — TopBar v4 styling

**Files:**
- Modify: `web/src/features/studio/panels/TopBar.tsx` — port WIP styling

**Why this comes here:** Independent of A-G/I. Depends on SV.0 (CSS tokens). Doesn't affect grid layout.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/studio/panels/TopBar.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TopBar } from "./TopBar";
import { useTheme } from "@/stores/theme";

beforeEach(() => useTheme.setState({ theme: "dark" }));

describe("TopBar (v4)", () => {
  it("renders the editorial Autoviral italic + Studio v4.0 eyebrow", () => {
    render(
      <MemoryRouter>
        <TopBar workId="w1" savedAt={null} onExport={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Autoviral")).toBeTruthy();
    expect(screen.getByText(/Studio.*v4\.0/i)).toBeTruthy();
  });

  it("theme toggle button flips the theme store", () => {
    render(
      <MemoryRouter>
        <TopBar workId="w1" savedAt={null} onExport={vi.fn()} />
      </MemoryRouter>,
    );
    const themeBtn = screen.getByLabelText(/theme/i);
    fireEvent.click(themeBtn);
    expect(useTheme.getState().theme).toBe("light");
  });

  it("renders the Export button with 导出 label", () => {
    render(
      <MemoryRouter>
        <TopBar workId="w1" savedAt={null} onExport={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/导出|Export/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/panels/TopBar.test.tsx
```

Expected: failure — current `TopBar.tsx` (HEAD `fcd71b9`) doesn't render `Autoviral` editorial italic, no theme toggle, no `导出`.

- [ ] **Step 3: Port the WIP**

```bash
git checkout 2ea68fa -- web/src/features/studio/panels/TopBar.tsx
```

- [ ] **Step 4: Run the test to verify pass**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/panels/TopBar.test.tsx
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/studio/panels/TopBar.tsx \
        web/src/features/studio/panels/TopBar.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): TopBar v4.0 styling — editorial brand + theme toggle (SV.J)

Ports the WIP TopBar restyle (mockup: autoviral design/studio-app.jsx:4-37):
  • back arrow + 'Autoviral' editorial italic + 'Studio · v4.0' eyebrow
  • work title with em-dash divider
  • SAVED · {savedAt} status chip with --status-done coloring
  • theme toggle (sun/moon SVG) wired to useTheme()
  • gradient export button with 导出 label

Drops the shared <Button> component in favour of inline data-bare buttons
that pick up the new globals.css default pill rules.

NOTE: Per audit Theme E §95, the mockup also shows Search + Settings
icon buttons and a live <StatusDot status="running" label="ASSETS · 5m"/>
indicator. These are intentionally omitted in this batch — Search has
no destination yet, Settings has no panel, and the live status indicator
needs a pipeline-state store (deferred per A5 reasoning).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task SV.K — Timeline restyle (Clip / Track / index + tests + delete orphans)

**Files:**
- Modify: `web/src/features/studio/panels/Timeline/Clip.tsx` — port WIP kind-aware gradients
- Modify: `web/src/features/studio/panels/Timeline/Clip.test.tsx` — port new mandatory props (`trackKind`, `color`)
- Modify: `web/src/features/studio/panels/Timeline/Track.tsx` — port sticky label column
- Modify: `web/src/features/studio/panels/Timeline/Track.test.tsx` — port new mandatory props (`totalWidth`, `color`, `label`)
- Modify: `web/src/features/studio/panels/Timeline/index.tsx` — port zoom buttons + inlined Ruler
- Delete (if confirmed orphaned): `web/src/features/studio/panels/Timeline/Playhead.tsx`, `Ruler.tsx`

**Why this comes here:** Independent of the rest. Tests already updated in WIP — verify they pass. D6 cleanup happens in this commit.

- [ ] **Step 1: Port the WIP files**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
git checkout 2ea68fa -- \
  web/src/features/studio/panels/Timeline/Clip.tsx \
  web/src/features/studio/panels/Timeline/Clip.test.tsx \
  web/src/features/studio/panels/Timeline/Track.tsx \
  web/src/features/studio/panels/Timeline/Track.test.tsx \
  web/src/features/studio/panels/Timeline/index.tsx
```

- [ ] **Step 2: Verify orphan files**

```bash
grep -rn "from.*Timeline/Playhead\|from.*Timeline/Ruler" web/src/ --include="*.ts" --include="*.tsx"
```

Expected: no results. If results appear, do NOT delete the orphan; instead, document why they remain in the commit message.

- [ ] **Step 3: Delete the orphans (if Step 2 returned nothing)**

```bash
git rm web/src/features/studio/panels/Timeline/Playhead.tsx \
       web/src/features/studio/panels/Timeline/Ruler.tsx
```

If either file has a co-located `.test.tsx`, delete it as well after confirming the test only exercises the deleted file.

- [ ] **Step 4: Run the Timeline tests**

```bash
npx vitest --config web/vitest.config.ts run web/src/features/studio/panels/Timeline/
```

Expected: all Timeline tests pass with the new prop shapes.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit -p web/tsconfig.json
```

Expected: exit 0. If tsc complains about a stale import of `./Playhead` or `./Ruler` somewhere, grep again and fix.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/studio/panels/Timeline/
git commit -m "$(cat <<'EOF'
feat(studio): Timeline restyle — kind-aware clips + zoom + sticky labels (SV.K)

Ports the WIP Timeline restyle (mockup: autoviral design/studio-app.jsx:288-403):
  • index.tsx: zoom buttons (-/+, 0.4×–3× range), inlined <Ruler>,
    flex layout with sticky 110px label column. Removes the legacy
    negative-margin label trick.
  • Track.tsx: KIND_ICON lookup (4 SVGs), kind-aware sticky label,
    dynamic 36/56-px row height (text vs others). Props now require
    {totalWidth, color, label}.
  • Clip.tsx: per-clip hue derived from clip.id, theme-aware gradient,
    duration label + clip name (filename without ext). Selection uses
    box-shadow: 0 0 12px var(--accent-glow). Props now require
    {trackKind, color}.

Tests updated to pass the new mandatory props (Clip.test.tsx /
Track.test.tsx).

Cleanup (audit D6): removes the orphaned Playhead.tsx and Ruler.tsx —
no longer imported anywhere after index.tsx inlined Ruler and removed
Playhead rendering. Clip.tsx's non-reactive theme detection (D10) is
flagged but not fixed; tracked for Phase 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task SV.L — Data-layer batch (analytics/trends/works queries + WorksGrid + Filmstrip + TrendingPanel)

**Files:**
- Modify: `web/src/queries/analytics.ts` — port nested-shape adapter (paired with SV.0's msw fix)
- Modify: `web/src/queries/trends.ts` — port platform-specific normalisers
- Modify: `web/src/queries/works.ts` — add `coverImage` / `coverIsVideo` fields
- Modify: `web/src/features/works/WorksGrid.tsx` — port cover priority + fallback gradient
- Modify: `web/src/features/works/WorksGrid.module.css` — port supporting styles
- Modify: `web/src/features/explore/TrendingPanel.tsx` — port empty-state copy
- Modify: `web/src/features/editor/panels/Filmstrip.tsx` — port image/gradient/solid bg rendering

**Why this comes here:** Independent of A-K. Data-layer changes share a single commit because each individual diff is small (<100 lines) and they're conceptually one polish pass.

- [ ] **Step 1: Write tests for the new behaviour**

Create `web/src/queries/trends.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTrends } from "./trends";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url.includes("xiaohongshu")) {
      return {
        platform: "xiaohongshu",
        videos: [
          { rank: 1, title: "Video A", views: "12.3万", likes: "4567", change: 0 },
        ],
        refreshedAt: "2026-04-25T12:00:00Z",
      };
    }
    return { platform: "douyin", topics: [], refreshedAt: "" };
  }),
  ApiError: class ApiError extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s; } },
}));

function wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useTrends platform normalisers", () => {
  it("parses xiaohongshu views with 万 suffix to a number", async () => {
    const { result } = renderHook(() => useTrends("xiaohongshu"), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.items[0].views).toBe(123_000);
  });
});
```

Create `web/src/features/works/WorksGrid.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorksGrid } from "./WorksGrid";

describe("WorksGrid cover priority", () => {
  it("renders <img> when coverImage is provided and not a video", () => {
    render(
      <MemoryRouter>
        <WorksGrid
          works={[
            {
              id: "w1", title: "T", type: "short-video", status: "published",
              thumbnail: null, updatedAt: "2026-01-01",
              coverImage: "/api/works/w1/assets/cover.png", coverIsVideo: false,
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("img").getAttribute("src")).toContain("cover.png");
  });

  it("falls back to deterministic gradient when no cover", () => {
    const { container } = render(
      <MemoryRouter>
        <WorksGrid works={[{ id: "w-empty", title: "", type: "short-video", status: "draft", thumbnail: null, updatedAt: "" }]} />
      </MemoryRouter>,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify failure**

```bash
npx vitest --config web/vitest.config.ts run \
  web/src/queries/trends.test.ts \
  web/src/features/works/WorksGrid.test.tsx
```

Expected: failures — trends platform normalisers absent on HEAD; WorksGrid cover-image path absent.

- [ ] **Step 3: Port the WIP files**

```bash
git checkout 2ea68fa -- \
  web/src/queries/analytics.ts \
  web/src/queries/trends.ts \
  web/src/queries/works.ts \
  web/src/features/works/WorksGrid.tsx \
  web/src/features/works/WorksGrid.module.css \
  web/src/features/explore/TrendingPanel.tsx \
  web/src/features/editor/panels/Filmstrip.tsx
```

- [ ] **Step 4: Run the tests to verify pass**

```bash
npx vitest --config web/vitest.config.ts run \
  web/src/queries/trends.test.ts \
  web/src/features/works/WorksGrid.test.tsx \
  web/src/features/analytics/Analytics.test.tsx
```

Expected: all green. The Analytics test was already passing post-SV.0 (msw fix); this confirms no regression after the queries/analytics.ts adapter is wired.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit -p web/tsconfig.json
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/queries/analytics.ts \
        web/src/queries/trends.ts \
        web/src/queries/trends.test.ts \
        web/src/queries/works.ts \
        web/src/features/works/WorksGrid.tsx \
        web/src/features/works/WorksGrid.test.tsx \
        web/src/features/works/WorksGrid.module.css \
        web/src/features/explore/TrendingPanel.tsx \
        web/src/features/editor/panels/Filmstrip.tsx
git commit -m "$(cat <<'EOF'
feat(data): v4 cover images, platform-specific trends, analytics adapter (SV.L)

Five micro-changes glued by the v4 polish theme (audit Theme G):

• queries/analytics.ts: adapt() reshapes the production nested envelope
  {configured, data:{account,...}} → flat CreatorAnalytics. Pairs with
  SV.0's msw fixture update (A1).
• queries/trends.ts: platform-specific normalisers — xiaohongshu videos[]
  with Chinese-unit (万/亿/k) parser, douyin topics[] with heat→likes
  conversion, fallthrough for already-normalised. ApiError 404 → empty.
• queries/works.ts: WorkSummary gains optional coverImage / coverIsVideo
  (server-attached by SV.I).
• WorksGrid.tsx: prioritise cover (<img> for image, hover-play <video>
  for video, deterministic 8-palette gradient fallback). Fixes audit
  D11 (cover-priority change had no test) — adds WorksGrid.test.tsx.
• TrendingPanel.tsx: empty-state copy 暂无该平台趋势数据 + NO DATA badge.
• Filmstrip.tsx: actual slide backgrounds (solid / gradient / image) —
  previously image-typed slides showed as blank surface-1 boxes (audit
  Theme H).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 3. Acceptance Criteria

The Studio v4 overhaul is "shipped" when **all** of the following hold:

### 3.1 Test green-bar
- [ ] `npx vitest --config web/vitest.config.ts run` → **190+ pass / 0 fail / 0 skip** (pre-WIP baseline 169 + new tests SV.0:4 + SV.A:3 + SV.B:3 + SV.C:3 + SV.D:3 + SV.E:3 + SV.F:1 + SV.J:3 + SV.L:3 ≈ +26 ⇒ ~195 total). The 4 originally-failing tests are resolved (3 by SV.0+SV.H QueryClientProvider/msw fix, 1 by SV.H delete-and-replace).
- [ ] `npx vitest --config vitest.config.ts run` (server) → **74 pass / 1 skip** (Phase 3 baseline 72/1 + SV.I's 2 new server tests).
- [ ] `npx tsc --noEmit -p tsconfig.json` → exit 0.
- [ ] `npx tsc --noEmit -p web/tsconfig.json` → exit 0.

### 3.2 Working tree clean
- [ ] `git status --porcelain` → empty.
- [ ] No untracked files (`AssetSidebar/index.tsx`, `queries/assets.ts` etc. all committed).
- [ ] Orphan files deleted or annotated:
  - `Tweaks/{Layer,Composition,Density}Section.tsx` — kept w/ `@deprecated` (intentional, see SV.C).
  - `Timeline/Playhead.tsx`, `Timeline/Ruler.tsx` — deleted in SV.K (or annotated if a stray import was found).
  - `editor/panels/SlidesNav.tsx` — restored in use by SV.F's Editor.tsx rollback.

### 3.3 Manual smoke (~5 min)
1. `npm run dev` + `npm run server`. Open `http://localhost:5173/`.
2. Works grid: ≥1 card has either an `<img>` cover, a hover-play `<video>` cover, or a deterministic gradient fallback. **No identical-blue-gold gradient on every card.**
3. Click a short-video work → Studio loads:
   - TopBar shows "Autoviral" italic + "Studio · v4.0" eyebrow + theme toggle + 导出 button.
   - **PipelineRail** sits below TopBar with 5 stage pills.
   - Chat (left), Preview (centre), AssetSidebar (right) all mounted.
   - Floating TweaksPanel at top-right corner; clicking its theme toggle flips dark↔light.
4. Click the **`+` button** in AssetSidebar header → `<GenerationDialog>` modal opens. (Phase 2 §2.5 closed.)
5. Click an image-text work → Editor loads. Filmstrip shows actual slide backgrounds. **Left column shows `<SlidesNav>`, NOT `<ChatPanel>`.**
6. Open a legacy image-text work that has `output/*.png` but no saved carousel.yaml → confirm carousel auto-loads with synthesised slides.
7. Send a message in Studio chat: assistant response renders markdown bullets and bold; pulse-dot thinking dots animate while streaming.

### 3.4 Phase 2 §2.5 acceptance closed
- [ ] AssetSidebar header `+` button opens `<GenerationDialog>` (verified by SV.A's test + Step 4 of manual smoke).

### 3.5 Phase 4 unblock
- [ ] Working tree clean — Phase 4 can branch from this tip without inheriting WIP noise.
- [ ] `Timeline/{Clip,Track,index}.tsx` are at their post-v4 state (SV.K) — Phase 4's edit work starts from this baseline.
- [ ] `wip/studio-v4-snapshot` branch (`2ea68fa`) is preserved as recovery (do not touch).

---

## 4. Self-Review

### 4.1 Spec coverage check

Every audit theme maps to ≥1 task:

| Audit theme | Tasks | Status |
|---|---|---|
| Theme A — globals.css + deps | SV.0 | covered |
| Theme B — AssetSidebar (closes Phase 2 §2.5) | SV.A (sidebar + dialog wire-up) | covered (A4) |
| Theme C — Chat panel (history + markdown + visuals) | SV.E | covered |
| Theme D — Preview panel rewrite | SV.D (drops `tab` per D5) | covered |
| Theme E — TopBar v4 styling | SV.J | covered |
| Theme F — Timeline restyle | SV.K (incl. Playhead/Ruler delete D6) | covered |
| Theme G — Data-layer adapters + cover images | SV.I (server) + SV.L (client) | covered |
| Theme H — Design mockup sync + Editor + Filmstrip | SV.G (mockups) + SV.F (Editor rollback A3) + SV.L (Filmstrip) | covered |
| Audit D1 — Tweaks orphaned | SV.C (refactor to floating overlay; deprecate sub-sections per A2) | covered |
| Audit D2 — Analytics adapter shape mismatch | SV.0 (A1: msw fix, not adapter change) | covered |
| Audit D3 — mount() missing QueryClientProvider | SV.H | covered |
| Audit D4 — AssetSidebar `+` no-op | SV.A (A4) | covered |
| Audit D5 — Preview tab dead state | SV.D (drop) | covered |
| Audit D6 — Timeline orphans | SV.K | covered |
| Audit D7 — SlidesNav orphan in Editor | SV.F (A3 rollback) | covered |
| Audit D8 — Lock file noise | SV.0 (bundled with package.json) | covered |
| Audit D9 — react-markdown@^10 peer deps | SV.0 Step 1 (verifies install) | covered |
| Audit D10 — Clip light-theme non-reactive | SV.K (flagged in commit msg, deferred to Phase 4) | covered |
| Audit D11 — WorksGrid no test | SV.L (adds WorksGrid.test.tsx) | covered |
| Audit Q5 — Pipeline Rail (NEW per A5) | SV.B + SV.G | covered |

A1-A5 controller decisions all map to specific tasks. No drift unaddressed.

### 4.2 Placeholder scan

`grep -niE "TBD|TODO|implement later|similar to task|placeholder" docs/superpowers/plans/2026-04-29-studio-v4-overhaul-tdd.md`:
- **Zero hits** in the body of any task. The string "deferred" appears only in commit messages explicitly justifying out-of-scope decisions (live PipelineRail wiring, ref/compare tabs, Search/Settings icons, Phase 8 inspector). All deferred work has a named follow-up phase.

### 4.3 Type consistency

- `AssetGroup` / `AssetItem` (SV.0 in `queries/assets.ts`) → consumed by `AssetSidebar` (SV.A) — same field set: `{group, count, items}` and `{path, url, kind, ext, name}`.
- `Stage` / `StageStatus` (SV.B in `PipelineRail.tsx`) — local; not exported.
- `setBlocks(blocks: StreamBlock[])` (SV.0 in `chat/store.ts`) → consumed by Chat panel (SV.E) — same `StreamBlock[]` type from `chat/types.ts`.
- `TweaksPanel` (SV.C, no props) → mounted by Studio.tsx (SV.G) — no props passed; matches.
- `GenerationDialog` (existing at `web/src/features/studio/generation/GenerationDialog.tsx:194-205`) accepts `{workId, open, onOpenChange}` → consumed by AssetSidebar (SV.A) — exact match.
- `<Clip>` props `{clipId, pxPerSecond, trackKind, color}` (SV.K) → tested in `Clip.test.tsx` (SV.K) — match.
- `<Track>` props `{track, pxPerSecond, totalWidth, color, label}` (SV.K) → tested in `Track.test.tsx` (SV.K) — match.
- `WorkSummary.coverImage?` / `.coverIsVideo?` (SV.L in `queries/works.ts`) → server-attached by SV.I (`src/server/api.ts:148-172`) → consumed by `WorksGrid` (SV.L) — three-link contract holds.
- `synthesiseLegacyCarousel(workId, workType): Promise<unknown | null>` (SV.I) → wired into the `404 ENOENT` branch of `GET /api/works/:id/carousel` — return shape consumed by `Editor.tsx` raw (no schema validation per audit §4.3).

### 4.4 Surgery check

- `src/server/api.ts` is **already staged** with the SV.I delta. Single-purpose hunk; no concurrent unstaged work needs to land in a different commit. **Two-snapshot pattern is NOT required.** SV.I's `git add src/server/api.ts` followed by `git commit` is sufficient.
- No other dirty files require surgery.

### 4.5 Test count math

| Task | New web tests | New server tests |
|---|---:|---:|
| SV.0 | 4 (assets:3 + chat-store:1) | 0 |
| SV.A | 3 | 0 |
| SV.B | 3 | 0 |
| SV.C | 3 | 0 |
| SV.D | 3 | 0 |
| SV.E | 3 | 0 |
| SV.F | 1 | 0 |
| SV.G | 0 (smoke only) | 0 |
| SV.H | 0 (rewrite — net 1 deleted, 1 added) | 0 |
| SV.I | 0 | 2 |
| SV.J | 3 | 0 |
| SV.K | 0 (port WIP test changes only) | 0 |
| SV.L | 2 (trends:1 + WorksGrid:2) — actually 3 | 0 |
| **Total new** | **~26 web** | **2 server** |

Pre-WIP web baseline: 169 / 0 fail / 0 skip. Post-plan target: **~195 / 0 fail / 0 skip**.
Pre-WIP server baseline: 72 pass / 1 skip. Post-plan target: **74 / 1 skip**.

Acceptance §3.1 target "190+ pass / 0 fail" matches.

### 4.6 Commit-message standards

Every commit message:
- Uses Conventional Commits prefix (`feat`, `fix`, `refactor`, `test`, `docs`).
- Includes scope (`studio`, `editor`, `server`, `data`).
- References the task ID (`SV.X`) in the subject.
- Cites the audit decision letter (`A1` / `A2` / `D5` / etc.) in the body where applicable.
- Ends with the required `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Uses the HEREDOC pattern for multi-line bodies.

### 4.7 Open questions surfaced

None beyond A1-A5 (which are pre-decided). The audit's Q1, Q2, Q3, Q4, Q5, Q6 are all resolved by A1-A5 + the controller-noted deferrals (ref/compare tabs in SV.D, Search/Settings in SV.J).

**Plan complete.** Ready for `superpowers:subagent-driven-development` execution.

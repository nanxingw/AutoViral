# Phase 5 — Variant Switcher + Provenance Dive Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the provenance DAG to the user — selecting a clip exposes its sibling variants in an Inspector tab with one-click rebind, and a full-screen Dive Canvas visualises the entire ancestry/descendant graph.

**Architecture:** Pure `walkProvenance()` answers ancestor / descendant / sibling queries off a Composition's `assets[]` + `provenance[]` (already populated by Phase 1). Studio store gains a single new action `rebindClip` that swaps a clip's `src` to another asset's `uri`. AssetSidebar grows a tabbed shell so the existing Library view + new Inspector view share the 320 px right column. DiveCanvas is a portal-rendered full-screen modal using ReactFlow, auto-laid-out via Dagre.

**Tech Stack:** React 18, TypeScript strict, Vitest + Testing Library. New deps: `reactflow@^11`, `@dagrejs/dagre@^1`. No pneuma reference — provenance dive is AutoViral-original.

---

## 0. Locked decisions (D1–D5)

Locked 2026-05-06 (this conversation). **Do not re-litigate.** Each task below cites the Dn it consumes.

| # | Decision | Lands in |
|---|---|---|
| **D1** | DAG visualisation uses **ReactFlow + @dagrejs/dagre**. +~180 KB minified, but DAG layout is a generic problem and ReactFlow is the de-facto React standard. | 5.C `DiveCanvas.tsx`, 5.D `useTreeLayout.ts` |
| **D2** | `AssetSidebar` gains a **tabbed shell** with two tabs: `Library` (existing content) and `Inspector` (new). Selecting a clip auto-activates the Inspector tab. | 5.B `AssetSidebar/index.tsx`, `Inspector/InspectorTab.tsx` |
| **D3** | `DiveCanvas` opens as a **full-screen modal** (portal + backdrop + ESC close), triggered from a button inside InspectorTab. Inline-in-sidebar embedding is rejected (320 px is too narrow for a DAG). | 5.C `DiveCanvas.tsx` |
| **D4** | `rebindClip` does **not** record a new provenance edge. Rebinding a clip is a UI op that changes which asset the clip points to; it does not create a new asset, so the DAG must not grow. | 5.B `store.ts: rebindClip` |
| **D5** | A root asset (`fromAssetId === null`) has an **empty siblings array**. The literal-contract reading "share the same `fromAssetId`" — null === null — would group all unrelated user uploads. We special-case this. | 5.A `walkProvenance.ts` |

---

## 1. File Structure

```
web/src/features/studio/
├── dive/                                                      ← NEW (Phase 5)
│   ├── walkProvenance.ts                                      ← 5.A pure DAG walker + URI lookup
│   ├── walkProvenance.test.ts                                 ← 5.A unit tests
│   ├── useTreeLayout.ts                                       ← 5.D Dagre layout hook
│   ├── useTreeLayout.test.ts                                  ← 5.D unit tests
│   ├── DiveCanvas.tsx                                         ← 5.C full-screen modal w/ ReactFlow
│   ├── DiveCanvas.test.tsx                                    ← 5.C component + integration tests
│   ├── nodes/
│   │   ├── NodeShell.tsx                                      ← 5.C common chrome + USE THIS button
│   │   ├── VisualNode.tsx                                     ← 5.C image / video tile
│   │   ├── AudioNode.tsx                                      ← 5.C audio tile (no waveform — 5.E may add)
│   │   └── TextNode.tsx                                       ← 5.C subtitle / text tile
│   └── __tests__/
│       └── integration.test.tsx                               ← 5.E end-to-end AC tests
│
├── panels/
│   ├── AssetSidebar/
│   │   ├── index.tsx                                          ← 5.B refactored to tab shell
│   │   ├── LibraryTab.tsx                                     ← 5.B (NEW — existing AssetSidebar body extracted)
│   │   └── index.test.tsx                                     ← 5.B existing + new tab tests
│   └── Inspector/                                             ← NEW (Phase 5)
│       ├── InspectorTab.tsx                                   ← 5.B Inspector tab body
│       ├── InspectorTab.test.tsx                              ← 5.B tests
│       ├── VariantSwitcher.tsx                                ← 5.B sibling list + rebind
│       └── VariantSwitcher.test.tsx                           ← 5.B tests
│
├── store.ts                                                   ← 5.B add rebindClip action
└── __tests__/store.test.ts                                    ← 5.B add rebindClip tests

web/src/test/
└── composition-fixtures.ts                                    ← 5.A append makeAssetEntry, makeProvenanceEdge, makeAssetGraph
```

---

## 2. Conventions for this plan

- **TDD**: every code change starts with a failing test. Run the test, see it fail with the *expected* error message, then write the minimal code to make it pass.
- **Commands**: this repo uses `bun` for the package manager and `vitest` for the test runner. Always run from the repo root (`/Users/nanjiayan/Desktop/AutoViral/autoviral`); the web bundle lives under `web/` but the test command is repo-rooted.
  - Run a single test: `bun run test:web -- web/src/.../some.test.ts -t "test name"`
  - Run a file's tests: `bun run test:web -- web/src/.../some.test.ts`
  - Run the full web suite: `bun run test:web`
  - Type-check: `bun run typecheck`
- **Commits**: bite-sized — usually one commit per Step group inside a Task. Use the message style of prior phases: `feat(scope): summary (Phase 5.X)` or `test(scope): summary (Phase 5.X)`. Include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` if running interactively.
- **Imports**: project uses `@/` alias for `web/src/`. Tests typically import from relative paths within their own folder; share fixtures sit in `web/src/test/`.

---

## Task 5.A — `walkProvenance` + URI lookup helper

**Goal:** Land the pure-function backbone. Zero UI in this task. After this task, `walkProvenance(comp, rootAssetId)` answers "give me ancestors / descendants / siblings of this asset", and `findAssetByUri(comp, uri)` lets the UI go from `clip.src` (URI) back to the bound `AssetEntry`.

**Files:**
- Create: `web/src/features/studio/dive/walkProvenance.ts`
- Create: `web/src/features/studio/dive/walkProvenance.test.ts`
- Modify: `web/src/test/composition-fixtures.ts` — append asset/provenance fixture helpers

### Step 1: Append asset / provenance fixture helpers (no test for fixtures themselves; they're scaffolding)

- [ ] **Step 1.1: Edit `web/src/test/composition-fixtures.ts` to append the helpers below**

Append at the end of the file (do not modify existing helpers):

```ts
import type { AssetEntry, ProvenanceEdge } from "../features/studio/types";

export function makeAssetEntry(
  over: Partial<AssetEntry> & Pick<AssetEntry, "id">,
): AssetEntry {
  return {
    uri: `/assets/${over.id}.png`,
    kind: "image",
    metadata: {},
    status: "ready",
    ...over,
  };
}

export function makeProvenanceEdge(
  over: Partial<ProvenanceEdge> & Pick<ProvenanceEdge, "toAssetId">,
): ProvenanceEdge {
  return {
    fromAssetId: null,
    operation: {
      type: "upload",
      actor: "user",
      timestamp: "2026-05-06T00:00:00Z",
      params: {},
    },
    ...over,
  };
}

/**
 * Build a Composition pre-populated with an asset graph.
 * `edges` is an array of [fromAssetId, toAssetId] pairs; assets without an
 * incoming edge are roots (fromAssetId === null in the resulting edge).
 *
 * Example: makeAssetGraph({ ids: ["a", "b", "c"], edges: [["a", "b"], ["a", "c"]] })
 *   → assets: [a, b, c]; provenance: [{to:a, from:null}, {to:b, from:a}, {to:c, from:a}]
 */
export function makeAssetGraph(opts: {
  ids: string[];
  edges?: Array<[string, string]>;
  workId?: string;
}): Composition {
  const c = makeEmptyComposition({ workId: opts.workId ?? "w" });
  const childToParent = new Map<string, string>();
  for (const [from, to] of opts.edges ?? []) childToParent.set(to, from);

  c.assets = opts.ids.map((id) => makeAssetEntry({ id }));
  c.provenance = opts.ids.map((id) =>
    makeProvenanceEdge({ toAssetId: id, fromAssetId: childToParent.get(id) ?? null }),
  );
  return c;
}
```

- [ ] **Step 1.2: Sanity-check imports — `Composition` is already imported at the top of the file; just verify no unused-import lint error**

Run: `bun run typecheck`
Expected: PASS (no errors).

- [ ] **Step 1.3: Commit**

```bash
git add web/src/test/composition-fixtures.ts
git commit -m "test(fixtures): add makeAssetEntry / makeProvenanceEdge / makeAssetGraph (Phase 5.A scaffold)"
```

### Step 2: Write 8 failing tests for `walkProvenance` + `findAssetByUri`

- [ ] **Step 2.1: Create `web/src/features/studio/dive/walkProvenance.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { walkProvenance, findAssetByUri } from "./walkProvenance";
import { makeAssetGraph } from "../../../test/composition-fixtures";

describe("walkProvenance", () => {
  it("returns empty arrays when comp has no assets", () => {
    const comp = makeAssetGraph({ ids: [] });
    const result = walkProvenance(comp, "missing");
    expect(result.ancestors).toEqual([]);
    expect(result.descendants).toEqual([]);
    expect(result.siblings).toEqual([]);
  });

  it("returns empty arrays for a single root asset (no relations)", () => {
    const comp = makeAssetGraph({ ids: ["root"] });
    const result = walkProvenance(comp, "root");
    expect(result.ancestors).toEqual([]);
    expect(result.descendants).toEqual([]);
    expect(result.siblings).toEqual([]);
  });

  it("walks a linear chain A → B → C from the middle node", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b", "c"],
      edges: [["a", "b"], ["b", "c"]],
    });
    const result = walkProvenance(comp, "b");
    expect(result.ancestors.map((a) => a.id)).toEqual(["a"]);
    expect(result.descendants.map((a) => a.id)).toEqual(["c"]);
    expect(result.siblings.map((a) => a.id)).toEqual([]);
  });

  it("finds siblings — assets sharing the same fromAssetId", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b", "c", "d"],
      edges: [["a", "b"], ["a", "c"], ["a", "d"]],
    });
    const result = walkProvenance(comp, "b");
    expect(result.siblings.map((a) => a.id).sort()).toEqual(["c", "d"]);
  });

  it("returns empty siblings for a root asset (D5 — root assets have no siblings)", () => {
    const comp = makeAssetGraph({
      ids: ["root1", "root2", "child"],
      edges: [["root1", "child"]],
    });
    const result = walkProvenance(comp, "root1");
    // root1 and root2 both have fromAssetId === null, but per D5 we do NOT
    // treat unrelated roots as siblings.
    expect(result.siblings).toEqual([]);
  });

  it("walks descendants breadth-first across multiple levels", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b", "c", "d"],
      edges: [["a", "b"], ["b", "c"], ["b", "d"]],
    });
    const result = walkProvenance(comp, "a");
    // BFS order: depth-1 first (b), then depth-2 (c, d). Order within a depth
    // follows the order edges appear in comp.provenance.
    expect(result.descendants.map((x) => x.id)).toEqual(["b", "c", "d"]);
  });

  it("returns empty arrays when rootAssetId is not in the comp", () => {
    const comp = makeAssetGraph({ ids: ["a"] });
    const result = walkProvenance(comp, "missing");
    expect(result).toEqual({ ancestors: [], descendants: [], siblings: [] });
  });
});

describe("findAssetByUri", () => {
  it("returns the matching AssetEntry for a known URI", () => {
    const comp = makeAssetGraph({ ids: ["alpha"] });
    // makeAssetEntry uses "/assets/<id>.png" as the default uri.
    const found = findAssetByUri(comp, "/assets/alpha.png");
    expect(found?.id).toBe("alpha");
  });

  it("returns null when no asset has that URI", () => {
    const comp = makeAssetGraph({ ids: ["alpha"] });
    expect(findAssetByUri(comp, "/nope.png")).toBeNull();
  });
});
```

- [ ] **Step 2.2: Run the tests — verify they fail because the module doesn't exist yet**

Run: `bun run test:web -- web/src/features/studio/dive/walkProvenance.test.ts`
Expected: All tests FAIL with `Failed to resolve import "./walkProvenance"`.

### Step 3: Implement `walkProvenance` + `findAssetByUri`

- [ ] **Step 3.1: Create `web/src/features/studio/dive/walkProvenance.ts`**

```ts
import type { AssetEntry, Composition, ProvenanceEdge } from "../types";

/**
 * Walk the provenance DAG rooted at `rootAssetId`.
 *
 *   ancestors    — chain of `fromAssetId` parents, ordered nearest → furthest.
 *                  Stops at fromAssetId === null. Linear chain assumed (each
 *                  asset has at most one ProvenanceEdge in comp.provenance).
 *   descendants  — BFS of edges where fromAssetId === currentNode, then their
 *                  descendants, etc. Order: BFS layer-by-layer; within a layer,
 *                  preserves the edge order from comp.provenance.
 *   siblings     — assets that share the same fromAssetId as rootAssetId.
 *                  Per D5, root assets (fromAssetId === null) get [] not the
 *                  set of all other roots.
 *
 * Lookups against missing ids/edges are silent: callers can pass anything
 * and get back empty arrays. No exceptions.
 */
export interface ProvenanceWalk {
  ancestors: AssetEntry[];
  descendants: AssetEntry[];
  siblings: AssetEntry[];
}

export function walkProvenance(
  comp: Composition,
  rootAssetId: string,
): ProvenanceWalk {
  const assets = comp.assets ?? [];
  const edges = comp.provenance ?? [];
  const assetById = new Map(assets.map((a) => [a.id, a] as const));
  if (!assetById.has(rootAssetId)) {
    return { ancestors: [], descendants: [], siblings: [] };
  }

  // Index: child → parent (for ancestor walk + sibling lookup)
  const parentOf = new Map<string, string | null>();
  // Index: parent → ordered children (for descendant BFS)
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    parentOf.set(e.toAssetId, e.fromAssetId);
    if (e.fromAssetId != null) {
      const list = childrenOf.get(e.fromAssetId) ?? [];
      list.push(e.toAssetId);
      childrenOf.set(e.fromAssetId, list);
    }
  }

  // Ancestors: walk backward from root.
  const ancestors: AssetEntry[] = [];
  let cursor: string | null = parentOf.get(rootAssetId) ?? null;
  while (cursor != null) {
    const a = assetById.get(cursor);
    if (!a) break;
    ancestors.push(a);
    cursor = parentOf.get(cursor) ?? null;
  }

  // Descendants: BFS.
  const descendants: AssetEntry[] = [];
  const queue = [...(childrenOf.get(rootAssetId) ?? [])];
  const seen = new Set<string>([rootAssetId]);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const a = assetById.get(id);
    if (a) descendants.push(a);
    for (const c of childrenOf.get(id) ?? []) queue.push(c);
  }

  // Siblings: assets with the same parent. D5: root → [].
  const myParent = parentOf.get(rootAssetId) ?? null;
  let siblings: AssetEntry[] = [];
  if (myParent != null) {
    siblings = (childrenOf.get(myParent) ?? [])
      .filter((id) => id !== rootAssetId)
      .map((id) => assetById.get(id))
      .filter((a): a is AssetEntry => !!a);
  }

  return { ancestors, descendants, siblings };
}

/**
 * Reverse-lookup: given a clip.src URI, return the AssetEntry that owns it.
 * Phase 5 binding model: clip→asset is by URI (not by assetId on the clip).
 * Returns null when no asset matches.
 */
export function findAssetByUri(
  comp: Composition,
  uri: string,
): AssetEntry | null {
  const assets = comp.assets ?? [];
  return assets.find((a) => a.uri === uri) ?? null;
}
```

- [ ] **Step 3.2: Run the tests — verify they all pass**

Run: `bun run test:web -- web/src/features/studio/dive/walkProvenance.test.ts`
Expected: 9 tests PASS (8 walkProvenance + 2 findAssetByUri — wait, recount: 7 + 2 = 9).

If a test fails because of array-order assumptions in the descendants BFS test, double-check that `comp.provenance`'s edge order is preserved through the `childrenOf` map. The fixture builds edges in `opts.edges` order, so the test expectation `["b", "c", "d"]` matches.

- [ ] **Step 3.3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3.4: Commit**

```bash
git add web/src/features/studio/dive/walkProvenance.ts web/src/features/studio/dive/walkProvenance.test.ts
git commit -m "feat(dive): walkProvenance + findAssetByUri (Phase 5.A)"
```

---

## Task 5.B — `rebindClip` action + tabbed AssetSidebar + VariantSwitcher

**Goal:** Wire the user-facing core: store action `rebindClip` swaps a clip's `src`; AssetSidebar grows two tabs; the new Inspector tab shows `VariantSwitcher` which renders sibling variants of the selected clip's asset and a "USE THIS" button per sibling.

**Files:**
- Modify: `web/src/features/studio/store.ts` — add `rebindClip` to `CompState` and the action map
- Modify: `web/src/features/studio/__tests__/store.test.ts` — 4 rebindClip tests
- Create: `web/src/features/studio/panels/Inspector/VariantSwitcher.tsx`
- Create: `web/src/features/studio/panels/Inspector/VariantSwitcher.test.tsx`
- Create: `web/src/features/studio/panels/Inspector/InspectorTab.tsx`
- Create: `web/src/features/studio/panels/Inspector/InspectorTab.test.tsx`
- Create: `web/src/features/studio/panels/AssetSidebar/LibraryTab.tsx` (extract existing body)
- Modify: `web/src/features/studio/panels/AssetSidebar/index.tsx` — wrap in tab shell
- Modify: `web/src/features/studio/panels/AssetSidebar/index.test.tsx` — add tab tests

### Step 1: `rebindClip` store action — TDD

- [ ] **Step 1.1: Append 4 failing tests to `web/src/features/studio/__tests__/store.test.ts`**

(Append inside the existing top-level `describe("store", ...)` block — keep the existing file otherwise unmodified.)

```ts
import { makeAssetEntry } from "../../../test/composition-fixtures";

describe("rebindClip", () => {
  it("rebinds a clip's src to the target asset's uri", () => {
    const a = makeVideoClip({ id: "clip1", src: "/old.mp4" });
    const comp = makeCompositionWithClips([a]);
    comp.assets = [
      makeAssetEntry({ id: "old", uri: "/old.mp4", kind: "video" }),
      makeAssetEntry({ id: "new", uri: "/new.mp4", kind: "video" }),
    ];
    useComposition.setState({ comp });
    useComposition.getState().rebindClip("clip1", "new");
    const updated = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(updated.src).toBe("/new.mp4");
  });

  it("is a silent no-op when clipId is unknown", () => {
    const a = makeVideoClip({ id: "clip1", src: "/old.mp4" });
    const comp = makeCompositionWithClips([a]);
    comp.assets = [makeAssetEntry({ id: "new", uri: "/new.mp4", kind: "video" })];
    useComposition.setState({ comp });
    useComposition.getState().rebindClip("missing", "new");
    const unchanged = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(unchanged.src).toBe("/old.mp4");
  });

  it("is a silent no-op when newAssetId is not in comp.assets", () => {
    const a = makeVideoClip({ id: "clip1", src: "/old.mp4" });
    const comp = makeCompositionWithClips([a]);
    comp.assets = [makeAssetEntry({ id: "old", uri: "/old.mp4", kind: "video" })];
    useComposition.setState({ comp });
    useComposition.getState().rebindClip("clip1", "ghost");
    const unchanged = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(unchanged.src).toBe("/old.mp4");
  });

  it("does NOT add a provenance edge (D4)", () => {
    const a = makeVideoClip({ id: "clip1", src: "/old.mp4" });
    const comp = makeCompositionWithClips([a]);
    comp.assets = [
      makeAssetEntry({ id: "old", uri: "/old.mp4", kind: "video" }),
      makeAssetEntry({ id: "new", uri: "/new.mp4", kind: "video" }),
    ];
    comp.provenance = []; // start clean
    useComposition.setState({ comp });
    useComposition.getState().rebindClip("clip1", "new");
    expect(useComposition.getState().comp!.provenance).toEqual([]);
  });
});
```

- [ ] **Step 1.2: Run the new tests — expect 4 failures (action does not exist)**

Run: `bun run test:web -- web/src/features/studio/__tests__/store.test.ts -t "rebindClip"`
Expected: 4 FAIL — `state.rebindClip is not a function` or similar.

- [ ] **Step 1.3: Add `rebindClip` to the `CompState` interface in `web/src/features/studio/store.ts`**

Insert near the other Phase-1.6 actions (after `removeAsset: ...`):

```ts
  // Phase 5.B — rebind a clip to a different asset (no provenance edge per D4)
  rebindClip: (clipId: string, newAssetId: string) => void;
```

- [ ] **Step 1.4: Add the action implementation inside the `immer((set) => ({ ... }))` block, near the other clip actions**

Place it after the existing `splitClip` implementation (search for `splitClip:` to find the right spot):

```ts
    rebindClip: (clipId, newAssetId) =>
      set((s) => {
        if (!s.comp) return;
        const newAsset = s.comp.assets.find((a) => a.id === newAssetId);
        if (!newAsset) return; // unknown asset → silent no-op (test contract)
        for (const t of s.comp.tracks) {
          const c = (t.clips as Clip[]).find((c) => c.id === clipId);
          if (c) {
            // text clips have no `src` field — skip them; rebind only applies
            // to video / audio / overlay clips that bind to a media URI.
            if ("src" in c) {
              (c as { src: string }).src = newAsset.uri;
            }
            return;
          }
        }
        // clipId not found → silent no-op
      }),
```

- [ ] **Step 1.5: Run the tests again — expect all 4 to pass**

Run: `bun run test:web -- web/src/features/studio/__tests__/store.test.ts -t "rebindClip"`
Expected: 4 PASS.

- [ ] **Step 1.6: Run the full store test file to verify nothing else broke**

Run: `bun run test:web -- web/src/features/studio/__tests__/store.test.ts`
Expected: all PASS.

- [ ] **Step 1.7: Commit**

```bash
git add web/src/features/studio/store.ts web/src/features/studio/__tests__/store.test.ts
git commit -m "feat(studio): rebindClip store action (Phase 5.B)"
```

### Step 2: `VariantSwitcher` component — TDD

- [ ] **Step 2.1: Create `web/src/features/studio/panels/Inspector/VariantSwitcher.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VariantSwitcher } from "./VariantSwitcher";
import { useComposition } from "../../store";
import {
  makeAssetGraph,
  makeVideoClip,
} from "../../../../test/composition-fixtures";

function setupCompWithClipBoundToAsset(boundAssetId: string) {
  // Build a graph where boundAssetId is a child with 2 siblings.
  const comp = makeAssetGraph({
    ids: ["root", "alpha", "beta", "gamma"],
    edges: [["root", "alpha"], ["root", "beta"], ["root", "gamma"]],
  });
  // Bind a clip to alpha (uri "/assets/alpha.png" by fixture default).
  const clip = makeVideoClip({
    id: "clip-1",
    src: `/assets/${boundAssetId}.png`,
  });
  comp.tracks[0].clips.push(clip);
  return { comp, clipId: clip.id };
}

describe("VariantSwitcher", () => {
  it("renders an empty-state hint when no clip is selected", () => {
    useComposition.setState({ comp: null, selection: null });
    render(<VariantSwitcher />);
    expect(screen.getByText(/no clip selected/i)).toBeInTheDocument();
  });

  it("renders 'no variants' when the bound asset has zero siblings", () => {
    const comp = makeAssetGraph({ ids: ["solo"] });
    const clip = makeVideoClip({ id: "c", src: "/assets/solo.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "c" });
    render(<VariantSwitcher />);
    expect(screen.getByText(/no variants/i)).toBeInTheDocument();
  });

  it("renders one tile per sibling variant", () => {
    const { comp, clipId } = setupCompWithClipBoundToAsset("alpha");
    useComposition.setState({ comp, selection: clipId });
    render(<VariantSwitcher />);
    // Two siblings of alpha: beta + gamma.
    expect(screen.getByTestId("variant-tile-beta")).toBeInTheDocument();
    expect(screen.getByTestId("variant-tile-gamma")).toBeInTheDocument();
  });

  it("clicking USE THIS calls rebindClip with the right new asset id", () => {
    const { comp, clipId } = setupCompWithClipBoundToAsset("alpha");
    useComposition.setState({ comp, selection: clipId });
    const spy = vi.spyOn(useComposition.getState(), "rebindClip");
    render(<VariantSwitcher />);
    const useBetaBtn = screen.getByTestId("use-variant-beta");
    fireEvent.click(useBetaBtn);
    expect(spy).toHaveBeenCalledWith(clipId, "beta");
  });

  it("shows the currently-bound asset's id in a 'current' badge", () => {
    const { comp, clipId } = setupCompWithClipBoundToAsset("alpha");
    useComposition.setState({ comp, selection: clipId });
    render(<VariantSwitcher />);
    expect(screen.getByText(/current/i)).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2.2: Run — expect failures (component does not exist)**

Run: `bun run test:web -- web/src/features/studio/panels/Inspector/VariantSwitcher.test.tsx`
Expected: 5 FAIL.

- [ ] **Step 2.3: Create `web/src/features/studio/panels/Inspector/VariantSwitcher.tsx`**

```tsx
import { useComposition } from "../../store";
import { findAssetByUri, walkProvenance } from "../../dive/walkProvenance";
import type { AssetEntry, Clip } from "../../types";

/**
 * VariantSwitcher — sibling-variant browser for the selected clip's bound
 * asset. Maps clip.src → AssetEntry via findAssetByUri, then surfaces siblings
 * from walkProvenance(). Clicking USE THIS dispatches rebindClip(clipId,
 * siblingAssetId).
 *
 * Empty states:
 *   - no selection                  → "No clip selected"
 *   - selection but no bound asset  → "No variants"  (URI lookup miss)
 *   - bound asset has 0 siblings    → "No variants"
 */
export function VariantSwitcher() {
  const comp = useComposition((s) => s.comp);
  const selection = useComposition((s) => s.selection);
  const rebindClip = useComposition((s) => s.rebindClip);

  if (!comp || !selection) {
    return <EmptyState message="No clip selected — pick one in the timeline" />;
  }

  // Find the selected clip across all tracks.
  let selectedClip: Clip | null = null;
  for (const t of comp.tracks) {
    const c = (t.clips as Clip[]).find((c) => c.id === selection);
    if (c) {
      selectedClip = c;
      break;
    }
  }
  if (!selectedClip || !("src" in selectedClip)) {
    return <EmptyState message="Selected clip has no media binding" />;
  }

  const bound = findAssetByUri(comp, selectedClip.src);
  if (!bound) {
    return <EmptyState message="No variants — clip is not bound to a known asset" />;
  }

  const { siblings } = walkProvenance(comp, bound.id);
  if (siblings.length === 0) {
    return <EmptyState message="No variants — this asset has no sibling derivations" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <CurrentBadge asset={bound} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        {siblings.map((s) => (
          <VariantTile
            key={s.id}
            asset={s}
            onUse={() => rebindClip(selection, s.id)}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: 20,
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        color: "var(--text-dimmer)",
        letterSpacing: "0.04em",
        textAlign: "center",
      }}
    >
      {message}
    </div>
  );
}

function CurrentBadge({ asset }: { asset: AssetEntry }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: 6,
        border: "1px solid var(--accent)",
        background: "var(--accent-glow)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        color: "var(--accent-hi)",
      }}
    >
      <span style={{ opacity: 0.7 }}>CURRENT · </span>
      {asset.id}
    </div>
  );
}

function VariantTile({
  asset,
  onUse,
}: {
  asset: AssetEntry;
  onUse: () => void;
}) {
  return (
    <div
      data-testid={`variant-tile-${asset.id}`}
      style={{
        position: "relative",
        aspectRatio: "9/16",
        borderRadius: 8,
        border: "1px solid var(--glass-border)",
        overflow: "hidden",
        background: "var(--surface-0)",
      }}
    >
      {(asset.kind === "image" || asset.kind === "video") && (
        <img
          src={asset.uri}
          alt={asset.name ?? asset.id}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
          loading="lazy"
        />
      )}
      <button
        type="button"
        data-testid={`use-variant-${asset.id}`}
        onClick={onUse}
        style={{
          position: "absolute",
          bottom: 6,
          left: 6,
          right: 6,
          padding: "4px 8px",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
          border: "1px solid var(--accent)",
          background: "rgba(0,0,0,0.55)",
          color: "var(--accent-hi)",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        USE THIS · {asset.id}
      </button>
    </div>
  );
}
```

- [ ] **Step 2.4: Run — expect 5 PASS**

Run: `bun run test:web -- web/src/features/studio/panels/Inspector/VariantSwitcher.test.tsx`
Expected: 5 PASS.

- [ ] **Step 2.5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 2.6: Commit**

```bash
git add web/src/features/studio/panels/Inspector/VariantSwitcher.tsx web/src/features/studio/panels/Inspector/VariantSwitcher.test.tsx
git commit -m "feat(inspector): VariantSwitcher (Phase 5.B)"
```

### Step 3: `InspectorTab` shell — TDD

- [ ] **Step 3.1: Create `web/src/features/studio/panels/Inspector/InspectorTab.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InspectorTab } from "./InspectorTab";
import { useComposition } from "../../store";
import {
  makeAssetGraph,
  makeVideoClip,
} from "../../../../test/composition-fixtures";

describe("InspectorTab", () => {
  it("shows VariantSwitcher when a clip is selected", () => {
    const comp = makeAssetGraph({
      ids: ["root", "alpha", "beta"],
      edges: [["root", "alpha"], ["root", "beta"]],
    });
    const clip = makeVideoClip({ id: "c", src: "/assets/alpha.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "c" });
    render(<InspectorTab />);
    expect(screen.getByTestId("variant-tile-beta")).toBeInTheDocument();
  });

  it("shows the no-selection empty state when nothing is selected", () => {
    useComposition.setState({ comp: null, selection: null });
    render(<InspectorTab />);
    expect(screen.getByText(/no clip selected/i)).toBeInTheDocument();
  });

  it("renders the 'Open in Dive' button (Phase 5.C trigger)", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b"],
      edges: [["a", "b"]],
    });
    const clip = makeVideoClip({ id: "c", src: "/assets/b.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "c" });
    render(<InspectorTab />);
    expect(screen.getByRole("button", { name: /open in dive/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3.2: Run — expect 3 FAIL (component doesn't exist)**

Run: `bun run test:web -- web/src/features/studio/panels/Inspector/InspectorTab.test.tsx`

- [ ] **Step 3.3: Create `web/src/features/studio/panels/Inspector/InspectorTab.tsx`**

The "Open in Dive" button is a placeholder during 5.B — clicking it does nothing. Phase 5.C will wire it to open `<DiveCanvas />`.

```tsx
import { useState } from "react";
import { VariantSwitcher } from "./VariantSwitcher";

export function InspectorTab() {
  // 5.B placeholder: in 5.C this will open the DiveCanvas modal.
  const [_diveOpen, setDiveOpen] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 14,
        height: "100%",
        overflow: "auto",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-editorial)",
          fontSize: 18,
          fontStyle: "italic",
          letterSpacing: "-0.015em",
          color: "var(--text)",
        }}
      >
        Inspector
      </div>
      <VariantSwitcher />
      <button
        type="button"
        onClick={() => setDiveOpen(true)}
        style={{
          padding: "8px 12px",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
          border: "1px solid var(--glass-border)",
          background: "var(--surface-0)",
          color: "var(--text-dim)",
          borderRadius: 6,
          cursor: "pointer",
          alignSelf: "flex-start",
        }}
      >
        Open in Dive
      </button>
    </div>
  );
}
```

- [ ] **Step 3.4: Run — expect 3 PASS**

Run: `bun run test:web -- web/src/features/studio/panels/Inspector/InspectorTab.test.tsx`
Expected: 3 PASS.

- [ ] **Step 3.5: Commit**

```bash
git add web/src/features/studio/panels/Inspector/InspectorTab.tsx web/src/features/studio/panels/Inspector/InspectorTab.test.tsx
git commit -m "feat(inspector): InspectorTab shell + Open-in-Dive placeholder (Phase 5.B)"
```

### Step 4: `AssetSidebar` tab shell refactor — extract LibraryTab + add tabs

- [ ] **Step 4.1: Create `web/src/features/studio/panels/AssetSidebar/LibraryTab.tsx` containing the *existing* AssetSidebar body**

This is a verbatim move of lines 25-150 from the current `index.tsx` (the JSX returned by `AssetSidebar`) plus the `AssetTile` component (lines 153-284) plus the `hueFromString` helper (lines 9-13). The signature changes from `AssetSidebar({ workId })` to `LibraryTab({ workId })`. Imports and side effects (`useWorkAssets`, `GenerationDialog`) move with it.

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

export function LibraryTab({ workId }: Props) {
  // ↓↓↓ paste the entire current AssetSidebar function body verbatim ↓↓↓
  const { data: groups = [], isLoading } = useWorkAssets(workId);
  const [active, setActive] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);

  const currentGroup = useMemo(() => {
    if (!groups.length) return null;
    return groups.find((g) => g.group === active) ?? groups[0];
  }, [groups, active]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* ... entire current AssetSidebar JSX, unchanged ... */}
      {/* Header + group chips + grid + GenerationDialog */}
    </div>
  );
}

// ↓↓↓ keep AssetTile here, identical to current ↓↓↓
function AssetTile({ item, index }: { item: AssetItem; index: number }) {
  // ... unchanged ...
}
```

> **Practical guidance for the engineer:** open the current `index.tsx`, copy lines 1-284 to `LibraryTab.tsx`, rename `function AssetSidebar` → `function LibraryTab`. Then delete the old content of `index.tsx` and rebuild it as the tab shell in Step 4.2.

- [ ] **Step 4.2: Replace `web/src/features/studio/panels/AssetSidebar/index.tsx` with the tab shell**

```tsx
import { useEffect, useState } from "react";
import { useComposition } from "@/features/studio/store";
import { LibraryTab } from "./LibraryTab";
import { InspectorTab } from "@/features/studio/panels/Inspector/InspectorTab";

interface Props {
  workId: string;
}

type Tab = "library" | "inspector";

/**
 * AssetSidebar — right-column shell for two views:
 *   - Library:   browse the work's asset library (existing behaviour)
 *   - Inspector: per-clip variant switcher + dive entry point (Phase 5.B)
 *
 * Auto-activation (D2): selecting a clip in the timeline switches the active
 * tab to "inspector". The user can override by clicking back to "library";
 * we then keep their choice until selection changes again.
 */
export function AssetSidebar({ workId }: Props) {
  const selection = useComposition((s) => s.selection);
  const [tab, setTab] = useState<Tab>("library");

  // D2 auto-activation — when selection arrives, jump to inspector.
  useEffect(() => {
    if (selection) setTab("inspector");
  }, [selection]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <TabBar tab={tab} onChange={setTab} />
      <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
        {tab === "library" ? <LibraryTab workId={workId} /> : <InspectorTab />}
      </div>
    </div>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 4,
        padding: "10px 14px 0",
        borderBottom: "1px solid var(--divider)",
      }}
    >
      <TabButton active={tab === "library"} onClick={() => onChange("library")}>
        Library
      </TabButton>
      <TabButton active={tab === "inspector"} onClick={() => onChange("inspector")}>
        Inspector
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-bare
      onClick={onClick}
      style={{
        padding: "6px 12px",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        background: "transparent",
        border: "none",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        color: active ? "var(--accent-hi)" : "var(--text-dimmer)",
        cursor: "pointer",
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4.3: Update or add tests in `web/src/features/studio/panels/AssetSidebar/index.test.tsx`**

Read the existing test file first; preserve all existing tests. Append:

```tsx
import { useComposition } from "@/features/studio/store";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AssetSidebar } from "./index";
import { makeAssetGraph, makeVideoClip } from "../../../../test/composition-fixtures";

describe("AssetSidebar tabs (Phase 5.B)", () => {
  it("starts on the Library tab when nothing is selected", () => {
    useComposition.setState({ comp: null, selection: null });
    render(<AssetSidebar workId="w" />);
    expect(screen.getByRole("tab", { name: /library/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("auto-activates the Inspector tab when a clip becomes selected", () => {
    const comp = makeAssetGraph({ ids: ["solo"] });
    comp.tracks[0].clips.push(makeVideoClip({ id: "c", src: "/assets/solo.png" }));
    useComposition.setState({ comp, selection: null });
    const { rerender } = render(<AssetSidebar workId="w" />);
    useComposition.setState({ selection: "c" });
    rerender(<AssetSidebar workId="w" />);
    expect(screen.getByRole("tab", { name: /inspector/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("manual click on Library tab keeps the user's choice", () => {
    const comp = makeAssetGraph({ ids: ["solo"] });
    comp.tracks[0].clips.push(makeVideoClip({ id: "c", src: "/assets/solo.png" }));
    useComposition.setState({ comp, selection: "c" });
    render(<AssetSidebar workId="w" />);
    // Effect fires on mount, then user toggles back.
    fireEvent.click(screen.getByRole("tab", { name: /library/i }));
    expect(screen.getByRole("tab", { name: /library/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
```

- [ ] **Step 4.4: Run the AssetSidebar tests — expect existing tests + 3 new tests all PASS**

Run: `bun run test:web -- web/src/features/studio/panels/AssetSidebar/index.test.tsx`
Expected: PASS.

- [ ] **Step 4.5: Run the full web suite to catch regressions**

Run: `bun run test:web`
Expected: PASS.

- [ ] **Step 4.6: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4.7: Commit**

```bash
git add web/src/features/studio/panels/AssetSidebar/index.tsx web/src/features/studio/panels/AssetSidebar/LibraryTab.tsx web/src/features/studio/panels/AssetSidebar/index.test.tsx
git commit -m "feat(asset-sidebar): tabbed Library / Inspector shell (Phase 5.B)"
```

---

## Task 5.C — `DiveCanvas` modal + ReactFlow integration

**Goal:** Land the full-screen DAG visualiser. Triggered from the Inspector's "Open in Dive" button, renders all of `comp.assets` as ReactFlow nodes (kind-specific) with edges following `comp.provenance`. Each node has its own "USE THIS" button that rebinds the *currently-selected* clip to that node's asset. ESC + backdrop-click close the modal.

**Files:**
- Modify: `package.json` — add `reactflow`, `@dagrejs/dagre`
- Create: `web/src/features/studio/dive/nodes/NodeShell.tsx`
- Create: `web/src/features/studio/dive/nodes/VisualNode.tsx`
- Create: `web/src/features/studio/dive/nodes/AudioNode.tsx`
- Create: `web/src/features/studio/dive/nodes/TextNode.tsx`
- Create: `web/src/features/studio/dive/DiveCanvas.tsx`
- Create: `web/src/features/studio/dive/DiveCanvas.test.tsx`
- Modify: `web/src/features/studio/panels/Inspector/InspectorTab.tsx` — wire Open-in-Dive button

### Step 1: Install dependencies

- [ ] **Step 1.1: Add deps**

Run: `cd /Users/nanjiayan/Desktop/AutoViral/autoviral && bun add reactflow @dagrejs/dagre`
Expected: lockfile + package.json updated.

- [ ] **Step 1.2: Verify installation**

Run: `bun run typecheck`
Expected: PASS (no module-not-found errors).

- [ ] **Step 1.3: Commit the dep change before any code, so the install is its own reviewable change**

```bash
git add package.json bun.lock
git commit -m "chore(deps): add reactflow + @dagrejs/dagre for Phase 5.C dive canvas"
```

### Step 2: Node components — `NodeShell`, kind-specific tiles

These are small enough to land without per-component test files; the `DiveCanvas.test.tsx` integration tests will cover their behaviour through the rendered DAG.

- [ ] **Step 2.1: Create `web/src/features/studio/dive/nodes/NodeShell.tsx`**

```tsx
import { Handle, Position } from "reactflow";
import type { ReactNode } from "react";

export interface NodeShellProps {
  assetId: string;
  isCurrent: boolean;
  onUse: () => void;
  children: ReactNode;
}

export function NodeShell({ assetId, isCurrent, onUse, children }: NodeShellProps) {
  return (
    <div
      data-testid={`dive-node-${assetId}`}
      style={{
        width: 180,
        height: 120,
        position: "relative",
        borderRadius: 10,
        border: `1px solid ${isCurrent ? "var(--accent)" : "var(--glass-border)"}`,
        background: "var(--surface-0)",
        overflow: "hidden",
        boxShadow: isCurrent ? "0 0 12px var(--accent-glow)" : "none",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      {children}
      <button
        type="button"
        data-testid={`dive-use-${assetId}`}
        onClick={onUse}
        disabled={isCurrent}
        style={{
          position: "absolute",
          bottom: 6,
          left: 6,
          right: 6,
          padding: "3px 6px",
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
          border: "1px solid var(--accent)",
          background: isCurrent ? "var(--accent-glow)" : "rgba(0,0,0,0.55)",
          color: "var(--accent-hi)",
          borderRadius: 3,
          cursor: isCurrent ? "default" : "pointer",
          opacity: isCurrent ? 0.6 : 1,
        }}
      >
        {isCurrent ? "CURRENT" : `USE · ${assetId}`}
      </button>
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
    </div>
  );
}
```

- [ ] **Step 2.2: Create `web/src/features/studio/dive/nodes/VisualNode.tsx`**

```tsx
import type { NodeProps } from "reactflow";
import type { AssetEntry } from "../../types";
import { NodeShell } from "./NodeShell";

export interface VisualNodeData {
  asset: AssetEntry;
  isCurrent: boolean;
  onUse: () => void;
}

export function VisualNode({ data }: NodeProps<VisualNodeData>) {
  return (
    <NodeShell assetId={data.asset.id} isCurrent={data.isCurrent} onUse={data.onUse}>
      <img
        src={data.asset.uri}
        alt={data.asset.name ?? data.asset.id}
        loading="lazy"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
    </NodeShell>
  );
}
```

- [ ] **Step 2.3: Create `web/src/features/studio/dive/nodes/AudioNode.tsx`**

```tsx
import type { NodeProps } from "reactflow";
import type { AssetEntry } from "../../types";
import { NodeShell } from "./NodeShell";

export interface AudioNodeData {
  asset: AssetEntry;
  isCurrent: boolean;
  onUse: () => void;
}

export function AudioNode({ data }: NodeProps<AudioNodeData>) {
  return (
    <NodeShell assetId={data.asset.id} isCurrent={data.isCurrent} onUse={data.onUse}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          color: "var(--text-dim)",
          background: "linear-gradient(145deg, rgba(168,197,214,0.08), transparent)",
        }}
      >
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
          <polygon points="12 6 7 11 3 11 3 13 7 13 12 18 12 6" fill="currentColor" />
          <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" />
        </svg>
      </div>
    </NodeShell>
  );
}
```

- [ ] **Step 2.4: Create `web/src/features/studio/dive/nodes/TextNode.tsx`**

```tsx
import type { NodeProps } from "reactflow";
import type { AssetEntry } from "../../types";
import { NodeShell } from "./NodeShell";

export interface TextNodeData {
  asset: AssetEntry;
  isCurrent: boolean;
  onUse: () => void;
}

export function TextNode({ data }: NodeProps<TextNodeData>) {
  return (
    <NodeShell assetId={data.asset.id} isCurrent={data.isCurrent} onUse={data.onUse}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: 12,
          display: "grid",
          placeItems: "center",
          color: "var(--text-dim)",
          fontFamily: "var(--font-editorial)",
          fontStyle: "italic",
          fontSize: 28,
          letterSpacing: "-0.02em",
        }}
      >
        Aa
      </div>
    </NodeShell>
  );
}
```

### Step 3: `DiveCanvas` modal — TDD

- [ ] **Step 3.1: Create `web/src/features/studio/dive/DiveCanvas.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiveCanvas } from "./DiveCanvas";
import { useComposition } from "../store";
import {
  makeAssetGraph,
  makeVideoClip,
} from "../../../test/composition-fixtures";

describe("DiveCanvas", () => {
  it("renders a node per asset in comp.assets", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b", "c"],
      edges: [["a", "b"], ["a", "c"]],
    });
    useComposition.setState({ comp, selection: null });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    expect(screen.getByTestId("dive-node-a")).toBeInTheDocument();
    expect(screen.getByTestId("dive-node-b")).toBeInTheDocument();
    expect(screen.getByTestId("dive-node-c")).toBeInTheDocument();
  });

  it("renders nothing when open=false", () => {
    const comp = makeAssetGraph({ ids: ["a"] });
    useComposition.setState({ comp });
    render(<DiveCanvas open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("dive-node-a")).toBeNull();
  });

  it("USE THIS on a node calls rebindClip with the selected clip and that node's asset", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b"],
      edges: [["a", "b"]],
    });
    const clip = makeVideoClip({ id: "clip-1", src: "/assets/a.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "clip-1" });
    const spy = vi.spyOn(useComposition.getState(), "rebindClip");
    render(<DiveCanvas open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("dive-use-b"));
    expect(spy).toHaveBeenCalledWith("clip-1", "b");
  });

  it("the currently-bound asset's USE button is disabled and labelled CURRENT", () => {
    const comp = makeAssetGraph({
      ids: ["a", "b"],
      edges: [["a", "b"]],
    });
    const clip = makeVideoClip({ id: "clip-1", src: "/assets/a.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "clip-1" });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    const currentBtn = screen.getByTestId("dive-use-a");
    expect(currentBtn).toBeDisabled();
    expect(currentBtn.textContent).toMatch(/current/i);
  });

  it("ESC key calls onClose", () => {
    const comp = makeAssetGraph({ ids: ["a"] });
    useComposition.setState({ comp, selection: null });
    const onClose = vi.fn();
    render(<DiveCanvas open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("backdrop click calls onClose", () => {
    const comp = makeAssetGraph({ ids: ["a"] });
    useComposition.setState({ comp, selection: null });
    const onClose = vi.fn();
    render(<DiveCanvas open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("dive-backdrop"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows an empty-state message when comp has no assets", () => {
    const comp = makeAssetGraph({ ids: [] });
    useComposition.setState({ comp });
    render(<DiveCanvas open={true} onClose={() => {}} />);
    expect(screen.getByText(/no assets yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3.2: Run — expect 7 FAIL**

Run: `bun run test:web -- web/src/features/studio/dive/DiveCanvas.test.tsx`

- [ ] **Step 3.3: Create `web/src/features/studio/dive/DiveCanvas.tsx`**

```tsx
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { useComposition } from "../store";
import type { AssetEntry, Clip } from "../types";
import { findAssetByUri } from "./walkProvenance";
import { VisualNode } from "./nodes/VisualNode";
import { AudioNode } from "./nodes/AudioNode";
import { TextNode } from "./nodes/TextNode";

interface Props {
  open: boolean;
  onClose: () => void;
}

const nodeTypes = {
  visual: VisualNode,
  audio: AudioNode,
  text: TextNode,
};

export function DiveCanvas({ open, onClose }: Props) {
  const comp = useComposition((s) => s.comp);
  const selection = useComposition((s) => s.selection);
  const rebindClip = useComposition((s) => s.rebindClip);

  // Find the selected clip's currently-bound asset, if any.
  const currentAssetId = useMemo<string | null>(() => {
    if (!comp || !selection) return null;
    for (const t of comp.tracks) {
      const c = (t.clips as Clip[]).find((c) => c.id === selection);
      if (c && "src" in c) return findAssetByUri(comp, c.src)?.id ?? null;
    }
    return null;
  }, [comp, selection]);

  // Build ReactFlow nodes + edges from comp.assets / comp.provenance.
  // Layout x/y here is a quick column-grid placeholder; Phase 5.D replaces
  // this with Dagre via useTreeLayout.
  const { nodes, edges } = useMemo(() => {
    if (!comp) return { nodes: [] as Node[], edges: [] as Edge[] };
    const assets = comp.assets ?? [];
    const provenance = comp.provenance ?? [];
    const flowNodes: Node[] = assets.map((asset, i) => ({
      id: asset.id,
      type: kindToNodeType(asset),
      position: { x: i * 240, y: 0 }, // placeholder layout — replaced in 5.D
      data: {
        asset,
        isCurrent: asset.id === currentAssetId,
        onUse: () => {
          if (selection) rebindClip(selection, asset.id);
        },
      },
    }));
    const flowEdges: Edge[] = provenance
      .filter((e) => e.fromAssetId != null)
      .map((e) => ({
        id: `${e.fromAssetId}->${e.toAssetId}`,
        source: e.fromAssetId as string,
        target: e.toAssetId,
      }));
    return { nodes: flowNodes, edges: flowEdges };
  }, [comp, currentAssetId, selection, rebindClip]);

  // ESC handler
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const empty = !comp || (comp.assets ?? []).length === 0;

  return createPortal(
    <div
      data-testid="dive-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 11, 15, 0.85)",
        backdropFilter: "blur(8px)",
        zIndex: 1000,
        display: "grid",
        placeItems: "stretch",
      }}
    >
      <div
        // Stop click-through so internal canvas clicks don't dismiss.
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          inset: 40,
          borderRadius: 16,
          border: "1px solid var(--glass-border)",
          background: "var(--surface-0)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--divider)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-editorial)",
              fontStyle: "italic",
              fontSize: 22,
              letterSpacing: "-0.015em",
              color: "var(--text)",
            }}
          >
            Provenance Dive
          </span>
          <button type="button" onClick={onClose} aria-label="Close" data-bare>
            ×
          </button>
        </header>
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          {empty ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                color: "var(--text-dimmer)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            >
              No assets yet — generate or upload some, then come back.
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function kindToNodeType(asset: AssetEntry): "visual" | "audio" | "text" {
  if (asset.kind === "image" || asset.kind === "video") return "visual";
  if (asset.kind === "audio") return "audio";
  return "text"; // subtitle
}
```

- [ ] **Step 3.4: Run the DiveCanvas tests — expect 7 PASS**

Run: `bun run test:web -- web/src/features/studio/dive/DiveCanvas.test.tsx`

> If a test fails because `reactflow` requires real layout / measurements that jsdom cannot provide, the failure surfaces as nodes not rendering. Fallback: stub `reactflow` in `web/src/test/setup.ts`:
> ```ts
> // jsdom guard: ReactFlow needs ResizeObserver / IntersectionObserver in
> // some code paths. Provide minimal mocks.
> if (!global.ResizeObserver) {
>   global.ResizeObserver = class {
>     observe() {}
>     unobserve() {}
>     disconnect() {}
>   };
> }
> ```
> Add this to `setup.ts` only if the run actually fails on it; do not add proactively.

- [ ] **Step 3.5: Wire the Open-in-Dive button — modify `InspectorTab.tsx`**

Replace the Step 3.3 placeholder. Open `web/src/features/studio/panels/Inspector/InspectorTab.tsx` and edit:

```tsx
import { useState } from "react";
import { VariantSwitcher } from "./VariantSwitcher";
import { DiveCanvas } from "../../dive/DiveCanvas";

export function InspectorTab() {
  const [diveOpen, setDiveOpen] = useState(false);

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: 14,
          height: "100%",
          overflow: "auto",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-editorial)",
            fontSize: 18,
            fontStyle: "italic",
            letterSpacing: "-0.015em",
            color: "var(--text)",
          }}
        >
          Inspector
        </div>
        <VariantSwitcher />
        <button
          type="button"
          onClick={() => setDiveOpen(true)}
          style={{
            padding: "8px 12px",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em",
            border: "1px solid var(--glass-border)",
            background: "var(--surface-0)",
            color: "var(--text-dim)",
            borderRadius: 6,
            cursor: "pointer",
            alignSelf: "flex-start",
          }}
        >
          Open in Dive
        </button>
      </div>
      <DiveCanvas open={diveOpen} onClose={() => setDiveOpen(false)} />
    </>
  );
}
```

- [ ] **Step 3.6: Run all Inspector + Dive tests**

Run: `bun run test:web -- web/src/features/studio/panels/Inspector web/src/features/studio/dive`
Expected: PASS.

- [ ] **Step 3.7: Commit**

```bash
git add web/src/features/studio/dive web/src/features/studio/panels/Inspector/InspectorTab.tsx
git commit -m "feat(dive): DiveCanvas modal + ReactFlow nodes (Phase 5.C)"
```

---

## Task 5.D — `useTreeLayout` Dagre layout hook

**Goal:** Replace the placeholder column-grid layout in `DiveCanvas` with a Dagre-driven left-to-right tree layout. Pure function (no state); pull `nodes + edges`, compute `{ id → {x,y} }`.

**Files:**
- Create: `web/src/features/studio/dive/useTreeLayout.ts`
- Create: `web/src/features/studio/dive/useTreeLayout.test.ts`
- Modify: `web/src/features/studio/dive/DiveCanvas.tsx` — apply layout to nodes

### Step 1: Tests for `useTreeLayout`

- [ ] **Step 1.1: Create `web/src/features/studio/dive/useTreeLayout.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { useTreeLayout } from "./useTreeLayout";

describe("useTreeLayout", () => {
  it("returns an empty map for an empty graph", () => {
    const positions = useTreeLayout([], []);
    expect(positions.size).toBe(0);
  });

  it("places a single node at a stable position", () => {
    const positions = useTreeLayout(
      [{ id: "a", width: 180, height: 120 }],
      [],
    );
    expect(positions.has("a")).toBe(true);
    const p = positions.get("a")!;
    expect(typeof p.x).toBe("number");
    expect(typeof p.y).toBe("number");
  });

  it("places a chain A → B → C with monotonically increasing x (LR rankdir)", () => {
    const positions = useTreeLayout(
      [
        { id: "a", width: 180, height: 120 },
        { id: "b", width: 180, height: 120 },
        { id: "c", width: 180, height: 120 },
      ],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    );
    const xa = positions.get("a")!.x;
    const xb = positions.get("b")!.x;
    const xc = positions.get("c")!.x;
    expect(xa).toBeLessThan(xb);
    expect(xb).toBeLessThan(xc);
  });

  it("siblings (A → B; A → C) sit at the same depth (same x), different y", () => {
    const positions = useTreeLayout(
      [
        { id: "a", width: 180, height: 120 },
        { id: "b", width: 180, height: 120 },
        { id: "c", width: 180, height: 120 },
      ],
      [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
      ],
    );
    const xb = positions.get("b")!.x;
    const xc = positions.get("c")!.x;
    expect(xb).toBeCloseTo(xc, 0);
    const yb = positions.get("b")!.y;
    const yc = positions.get("c")!.y;
    expect(yb).not.toBeCloseTo(yc, 0);
  });

  it("returns a stable layout — same input → same output", () => {
    const inputNodes = [
      { id: "a", width: 180, height: 120 },
      { id: "b", width: 180, height: 120 },
    ];
    const inputEdges = [{ source: "a", target: "b" }];
    const a = useTreeLayout(inputNodes, inputEdges);
    const b = useTreeLayout(inputNodes, inputEdges);
    for (const id of ["a", "b"]) {
      expect(a.get(id)).toEqual(b.get(id));
    }
  });
});
```

- [ ] **Step 1.2: Run — expect FAIL (module missing)**

Run: `bun run test:web -- web/src/features/studio/dive/useTreeLayout.test.ts`

### Step 2: Implement the layout

- [ ] **Step 2.1: Create `web/src/features/studio/dive/useTreeLayout.ts`**

> **Note on naming.** It's called `useTreeLayout` to match the master plan §5.0 file structure, but it is a pure function, not a React hook (no useState/useEffect). We keep the name for consistency with the spec — the alternative was `computeTreeLayout`, which would force a rename in DiveCanvas as well.

```ts
import dagre from "@dagrejs/dagre";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface NodePosition {
  x: number;
  y: number;
}

/**
 * Compute LR-rankdir Dagre layout for a provenance DAG.
 * Returns a Map<id → {x, y}>. The x/y refer to the *top-left* corner
 * (Dagre's center-anchor is converted by subtracting half-width/height).
 *
 * Pure: same input → same output, no internal state.
 */
export function useTreeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Map<string, NodePosition> {
  const out = new Map<string, NodePosition>();
  if (nodes.length === 0) return out;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: n.width, height: n.height });
  }
  for (const e of edges) {
    // Skip edges that reference unknown nodes (defensive — shouldn't happen
    // with well-formed provenance, but a stray edge mustn't crash layout).
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  for (const n of nodes) {
    const node = g.node(n.id);
    if (!node) continue;
    out.set(n.id, {
      x: node.x - n.width / 2,
      y: node.y - n.height / 2,
    });
  }
  return out;
}
```

- [ ] **Step 2.2: Run the layout tests — expect 5 PASS**

Run: `bun run test:web -- web/src/features/studio/dive/useTreeLayout.test.ts`

### Step 3: Wire Dagre into `DiveCanvas`

- [ ] **Step 3.1: Edit `web/src/features/studio/dive/DiveCanvas.tsx`**

In the `useMemo` that builds nodes + edges, replace the placeholder `position: { x: i * 240, y: 0 }` with positions from `useTreeLayout`. Update imports too.

```tsx
import { useTreeLayout } from "./useTreeLayout";

// Inside the component, replace the existing useMemo block:
const { nodes, edges } = useMemo(() => {
  if (!comp) return { nodes: [] as Node[], edges: [] as Edge[] };
  const assets = comp.assets ?? [];
  const provenance = comp.provenance ?? [];

  const layoutInputNodes = assets.map((a) => ({ id: a.id, width: 180, height: 120 }));
  const layoutInputEdges = provenance
    .filter((e) => e.fromAssetId != null)
    .map((e) => ({ source: e.fromAssetId as string, target: e.toAssetId }));
  const positions = useTreeLayout(layoutInputNodes, layoutInputEdges);

  const flowNodes: Node[] = assets.map((asset) => ({
    id: asset.id,
    type: kindToNodeType(asset),
    position: positions.get(asset.id) ?? { x: 0, y: 0 },
    data: {
      asset,
      isCurrent: asset.id === currentAssetId,
      onUse: () => {
        if (selection) rebindClip(selection, asset.id);
      },
    },
  }));
  const flowEdges: Edge[] = layoutInputEdges.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
  }));
  return { nodes: flowNodes, edges: flowEdges };
}, [comp, currentAssetId, selection, rebindClip]);
```

- [ ] **Step 3.2: Run all Phase 5 tests — expect everything still passes**

Run: `bun run test:web -- web/src/features/studio/dive web/src/features/studio/panels/Inspector web/src/features/studio/__tests__/store.test.ts`
Expected: PASS.

- [ ] **Step 3.3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3.4: Commit**

```bash
git add web/src/features/studio/dive/useTreeLayout.ts web/src/features/studio/dive/useTreeLayout.test.ts web/src/features/studio/dive/DiveCanvas.tsx
git commit -m "feat(dive): Dagre layout via useTreeLayout (Phase 5.D)"
```

---

## Task 5.E — Phase 5 acceptance & integration tests

**Goal:** Validate the master-plan §5.3 acceptance criteria end-to-end, in a single integration test file. After this task lands, Phase 5 is complete.

**Files:**
- Create: `web/src/features/studio/dive/__tests__/integration.test.tsx`

### Step 1: Acceptance integration tests

- [ ] **Step 1.1: Create the test file**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AssetSidebar } from "../../panels/AssetSidebar";
import { useComposition } from "../../store";
import {
  makeAssetGraph,
  makeVideoClip,
} from "../../../../test/composition-fixtures";

describe("Phase 5 acceptance criteria", () => {
  it("AC1: 2-sibling variant switch through Inspector tab", () => {
    // Setup: a clip bound to "alpha" with 2 siblings (beta, gamma).
    const comp = makeAssetGraph({
      ids: ["root", "alpha", "beta", "gamma"],
      edges: [["root", "alpha"], ["root", "beta"], ["root", "gamma"]],
    });
    const clip = makeVideoClip({ id: "clip-1", src: "/assets/alpha.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "clip-1" });

    render(<AssetSidebar workId="w" />);

    // Inspector tab auto-activates because selection is set.
    expect(screen.getByTestId("variant-tile-beta")).toBeInTheDocument();
    expect(screen.getByTestId("variant-tile-gamma")).toBeInTheDocument();

    // Click USE THIS on beta.
    act(() => {
      fireEvent.click(screen.getByTestId("use-variant-beta"));
    });

    // Verify the store reflects the rebind.
    const updated = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(updated.src).toBe("/assets/beta.png");
  });

  it("AC2: DiveCanvas opens with full graph + USE THIS rebinds from a descendant node", () => {
    const comp = makeAssetGraph({
      ids: ["alpha", "beta", "gamma"],
      edges: [["alpha", "beta"], ["beta", "gamma"]],
    });
    const clip = makeVideoClip({ id: "clip-1", src: "/assets/alpha.png" });
    comp.tracks[0].clips.push(clip);
    useComposition.setState({ comp, selection: "clip-1" });

    render(<AssetSidebar workId="w" />);

    // Open the dive modal from Inspector.
    fireEvent.click(screen.getByRole("button", { name: /open in dive/i }));

    // All 3 nodes render.
    expect(screen.getByTestId("dive-node-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("dive-node-beta")).toBeInTheDocument();
    expect(screen.getByTestId("dive-node-gamma")).toBeInTheDocument();

    // Click USE on a descendant.
    act(() => {
      fireEvent.click(screen.getByTestId("dive-use-gamma"));
    });

    const updated = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(updated.src).toBe("/assets/gamma.png");
  });
});
```

- [ ] **Step 1.2: Run the integration tests**

Run: `bun run test:web -- web/src/features/studio/dive/__tests__/integration.test.tsx`
Expected: 2 PASS.

- [ ] **Step 1.3: Run the full web suite + typecheck as a final gate**

Run: `bun run test:web && bun run typecheck`
Expected: PASS.

- [ ] **Step 1.4: Commit**

```bash
git add web/src/features/studio/dive/__tests__/integration.test.tsx
git commit -m "test(phase-5): AC1+AC2 integration tests (Phase 5.E)"
```

- [ ] **Step 1.5: Final milestone commit (empty allowed if no further changes)**

```bash
git commit --allow-empty -m "feat(phase-5): variant switcher + dive views — milestone"
```

---

## 3. Phase 5 Acceptance Criteria

These mirror master plan §5.3 and are verified by Task 5.E:

- [x] AC1: Selecting a clip whose asset has 2 derived siblings shows both in the Variant Switcher; clicking "USE THIS" on a sibling rebinds the clip and the store reflects the new src. (Test: AC1)
- [x] AC2: DiveCanvas opens for any asset in the comp; shows full ancestry + descendants; clicking USE THIS in a descendant rebinds. (Test: AC2)

Additional implementation-level criteria not in the master plan but required for ship:

- [ ] Bundle delta tracked: install of `reactflow` + `@dagrejs/dagre` should add < 250 KB minified to the prod bundle. If higher, file a follow-up.
- [ ] `bun run typecheck` clean.
- [ ] Full `bun run test:web` suite green; net new tests ≈ 28 (8 walkProvenance + 4 rebindClip + 5 VariantSwitcher + 3 InspectorTab + 3 AssetSidebar tabs + 7 DiveCanvas + 5 useTreeLayout + 2 integration = 37 — adjust as actual count rolls in).

---

## 4. Open follow-ups (deferred — do not implement in Phase 5)

These would expand Phase 5 beyond its master-plan scope. Track for a Phase 5.5 or Phase 6 polish window:

- **Multi-parent provenance.** Today `walkProvenance` assumes each asset has at most one parent (linear ancestry). If a future operation produces an asset from two sources (e.g., a mix), the ancestor walk needs to become a BFS. The walker is already future-proofed (each loop iteration looks up `parentOf`), but the data shape allows only one fromAssetId per edge.
- **Mini-thumbnails on AudioNode.** Could reuse the Phase 4.E `useWaveform` hook to render waveform peaks inside AudioNode. Not required for AC2.
- **Search / filter inside DiveCanvas.** Once asset count grows past ~50, navigating the full DAG is awkward. Add a search bar (highlights matching nodes, dims others).
- **Provenance edge labels.** ReactFlow supports edge labels — currently we render bare lines. Showing `operation.type` ("derive" / "trim" / "caption") would make the graph more legible.
- **Rebind history.** D4 says we don't write a provenance edge on rebind. If product later wants an undo/history of binding decisions, it'd live in a separate `bindingHistory` field on Composition, not in `provenance` (preserves the meaning of the DAG).

---

## 5. Self-review (writing-plans skill — done by author of this plan, not the engineer)

**Spec coverage:** Master plan §5.2 lists 5.A walkProvenance, 5.B VariantSwitcher, 5.C DiveCanvas, 5.D useTreeLayout. All four are mapped to tasks above. Acceptance criteria 5.3 covered by Task 5.E. ✅

**Placeholder scan:** No "TBD"/"TODO" entries inside steps. The InspectorTab in 5.B Step 3.3 has a deliberate Step 3.5 follow-up in 5.C — flagged in the Step 3.3 comment as "5.B placeholder". ✅

**Type consistency:** `walkProvenance` returns `{ ancestors, descendants, siblings }` of `AssetEntry[]` everywhere it's consumed. `findAssetByUri` returns `AssetEntry | null`. `rebindClip(clipId, newAssetId)` matches the 4 store-test calls and the 1 VariantSwitcher dispatch and the 1 DiveCanvas dispatch. NodeShell's `isCurrent` prop is wired identically in the 3 kind-specific node tiles. `useTreeLayout(nodes, edges)` signature matches between definition and DiveCanvas consumption. ✅

**Ambiguity:** D5 was the major one (root siblings) and is locked. The "auto-activate Inspector tab" behaviour (5.B Step 4.2) has a clear rule: `selection != null → tab = "inspector"`, but does not flip back when `selection === null`; manual library-tab clicks persist until next selection arrives. Locked in code; documented in InspectorTab effect comment. ✅

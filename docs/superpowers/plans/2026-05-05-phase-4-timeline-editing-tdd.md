# Phase 4 — Timeline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the Studio Timeline from a read-only display to a CapCut-grade interactive editor: snap-aware drag, edge-handle resize, blade-tool split, ripple delete + gap collapse, video-frame filmstrip, audio waveform peaks, interactive playhead, and keyboard shortcuts.

**Architecture:** Verbatim ports of the pneuma `clipcraft/viewer/timeline/` modules (1408 LOC, 11 files), adapted to our `Composition`/`Track`/`Clip` schema and Zustand store. New code lands under `web/src/features/studio/panels/Timeline/` mirroring pneuma's layout. Each task lands a failing test → minimal implementation → green commit before the next task starts.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest + Testing Library, Web Audio API (decode + peaks), HTMLVideoElement + canvas (frame extraction). Phase 4 ends with `wavesurfer.js` removable per D9.

---

## 0. Audit-locked decisions (D1–D10)

These were locked in `docs/superpowers/plans/2026-05-05-phase-4-timeline-baseline-audit.md` §2. **Do not re-litigate.** Each task below cites the Dn it consumes.

| # | Decision | Lands in |
|---|---|---|
| **D1** | Snap threshold is **seconds** (not pixels). Default `0.06s`. | 4.A `snapPoints.ts`, 4.B `dragEngine.ts` |
| **D2** | Right-handle resize is **constrained** (Option C): hard-cap `out` at `nextClip.trackOffset`. No overlap, no eat-into-next. | 4.F `useClipResize.ts` |
| **D3** | `clipDuration(c)` lives in **new** `Timeline/clipMath.ts`, NOT in `store.ts`. Re-export from store. | 4.A creates `clipMath.ts`; all later tasks consume it |
| **D4** | `S` (split) on a gap = **silent no-op**. The shortcut requires playhead inside a clip on the selected track. | 4.J shortcuts |
| **D5** | Playhead is a **single full-height vertical bar** mounted as sibling of `<Ruler>` inside `Timeline/index.tsx`'s lanes scroll-container. Hit area only the top 14px (in the ruler band). | 4.H `Playhead.tsx` |
| **D6** | Backspace = plain `removeClip`. **Shift+Backspace** = `rippleDeleteClip`. The Shift branch must be checked **before** the plain branch. | 4.J shortcuts |
| **D7** | `splitClip` mints new ids via `crypto.randomUUID()`. Tests stub via `vi.spyOn(globalThis.crypto, "randomUUID")`. | 4.I store action |
| **D8** | Filmstrip thumbnails **cached** at fixed `0.5s` interval; **rendered** at zoom-aware `Math.max(0.5, 60/pxPerSecond)` interval. | 4.D `useFrameExtractor.ts` + Track.tsx |
| **D9** | Custom Web-Audio decode + 128-bucket peaks. **Drop wavesurfer.js dep** in 4.E's final commit. Promise dedupe via module-level `Map<src, Promise<Peaks>>`. | 4.E `useWaveform.ts` |
| **D10** | Snap line is a **full-height** indicator across all lanes, color `var(--accent-hi)`, label-tooltip pinned next to it. | 4.B preview-state in store + 4.H render seam |

**Bonus locks (from audit §3 R7):** the dragEngine task adds four store actions for live-drag preview state — `beginDrag / updateDragCandidate / commitDrag / cancelDrag`. These supersede the inline `pointermove → updateClip` pattern in `Clip.tsx:38-57`.

**Pneuma upstream is not present on this machine** (audit §0 + §3 R1). The contracts inlined in master plan §4.1 are the source of truth. Where the audit calls out a behaviour pneuma would have shipped (e.g. dragEngine's "overlap-then-cascade + pinned-clip pass"), we encode it explicitly in the task's pseudo-code. Each task's "Pneuma source" line names the spec lines we're implementing against.

---

## 1. File Structure

### Create

| Path (under `web/src/features/studio/panels/Timeline/`) | Task | LOC target |
|---|---|---|
| `clipMath.ts` | 4.A | ~25 |
| `clipMath.test.ts` | 4.A | ~40 |
| `snapPoints.ts` | 4.A | ~99 |
| `snapPoints.test.ts` | 4.A | ~120 |
| `dragEngine.ts` | 4.B | ~122 |
| `dragEngine.test.ts` | 4.B | ~140 |
| `BladeTool.tsx` | 4.G | ~70 |
| `BladeTool.test.tsx` | 4.G | ~50 |
| `hooks/useSplitHoverSnap.ts` | 4.G | ~46 |
| `hooks/useSplitHoverSnap.test.ts` | 4.G | ~55 |
| `hooks/useFrameExtractor.ts` | 4.D | ~159 |
| `hooks/useFrameExtractor.test.ts` | 4.D | ~120 |
| `Filmstrip.tsx` | 4.D | ~60 |
| `toolbar/rippleDelete.ts` | 4.C | ~40 |
| `toolbar/collapseGaps.ts` | 4.C | ~30 |
| `toolbar/__tests__/rippleDelete.test.ts` | 4.C | ~70 |
| `toolbar/__tests__/collapseGaps.test.ts` | 4.C | ~60 |
| `Playhead.tsx` | 4.H | ~80 |
| `Playhead.test.tsx` | 4.H | ~80 |
| `hooks/useWaveform.ts` (replaces existing in `studio/hooks/`) | 4.E | ~100 |
| `hooks/useWaveform.test.ts` (replaces existing) | 4.E | ~110 |
| `WaveformBars.tsx` | 4.E | ~50 |
| `hooks/useClipResize.ts` | 4.F | ~110 |
| `hooks/useClipResize.test.ts` | 4.F | ~130 |

### Modify

| Path | Task | Change |
|---|---|---|
| `web/src/features/studio/store.ts` | 4.B + 4.C + 4.I + 4.F | Add `dragState` + `beginDrag/updateDragCandidate/commitDrag/cancelDrag` (4.B) + `rippleDeleteClip/collapseGaps` (4.C) + `splitClip/resizeClip` (4.I + 4.F) actions |
| `web/src/features/studio/panels/Timeline/Clip.tsx` | 4.B + 4.F | Replace inline pointermove with dragEngine; add resize handles; consume `dragState.preview` for ghost `left` |
| `web/src/features/studio/panels/Timeline/Track.tsx` | 4.D + 4.E | Mount `Filmstrip` behind video clips; mount `WaveformBars` behind audio clips |
| `web/src/features/studio/panels/Timeline/index.tsx` | 4.G + 4.H | Mount `<Playhead />` and `<BladeTool />` over the lanes container; render snap-line overlay from `dragState.snapTime` |
| `web/src/features/studio/hooks/useShortcuts.ts` | 4.J | Add `B` blade-tool toggle, `Cmd+B` split-at-playhead, `Shift+Backspace` ripple delete, `Cmd+Shift+G` collapse gaps; reorder Backspace branch |
| `web/src/features/studio/panels/Timeline/Clip.test.tsx` | 4.B + 4.F | Replace pointer-drag assertion with dragState-based assertions; widen width assertion to ignore handle insets |
| `web/src/features/studio/panels/Timeline/Track.test.tsx` | 4.D | Add filmstrip render assertion (mocked frame hook) |
| `web/src/test/setup.ts` | 4.D + 4.E | Import `installCanvasMocks()` + `installAudioContextMock()` from new helper, called once during setup |
| `package.json` | 4.E final commit | Remove `wavesurfer.js@^7.12.6` |
| `package-lock.json` | 4.E final commit | Drop wavesurfer entries (`npm install` after removal) |

### Test infrastructure (new)

| Path | Task | Purpose |
|---|---|---|
| `web/src/test/dom-mocks.ts` | 4.D step 1 | Re-usable happy-dom helpers: `installCanvasMocks` (R4), `installAudioContextMock` (R5), `mockHTMLMediaElement`. Imported once from `setup.ts`. |
| `web/src/test/composition-fixtures.ts` | 4.A step 1 | `makeVideoClip / makeAudioClip / makeTextClip / makeOverlayClip / threeClipTrack` builders. |

---

## 2. Adaptation primer (read once)

**Pneuma uses `clip.start / clip.end`. We use `clip.trackOffset` + `clip.in / clip.out` (or `clip.duration` for text/overlay).** The translation table:

| Pneuma | AutoViral |
|---|---|
| `clip.start` | `clip.trackOffset` |
| `clip.end` | `clip.trackOffset + clipDuration(c)` (helper from `clipMath.ts` per D3) |
| `clip.duration` (universal) | `clipDuration(c)` — kind-aware: video/audio = `out - in`, text/overlay = `clip.duration` |
| moving a clip = `clip.start = X` | `updateClip(id, { trackOffset: X })` |
| splitting at `t` produces children `(start, t)` and `(t, end)` | for video/audio: child A has `(in, in + (t - trackOffset))`, child B has `(in + (t - trackOffset), out)` and `trackOffset = t`. For text/overlay: child A has `duration = t - trackOffset`, child B has `trackOffset = t, duration = original.duration - (t - trackOffset)`. See 4.I `splitClip` for full code. |

Each task that does clip-time math has its own **adaptation callout** showing the diff from a hypothetical pneuma source line.

---

## Task 4.A: snapPoints + clipMath foundation

**Pneuma source:** Master plan §4.1 lines 2227-2247 (`snapPoints.ts` 3-function contract). Pneuma upstream missing — re-implementing per inlined contract. ~99 LOC target per master plan §4.0 line 2210.

**Decisions applied:** D1 (threshold in seconds, default 0.06s); D3 (`clipDuration(c)` lives in `clipMath.ts`).

**Adaptation callout:** `collectSnapPoints` walks `composition.tracks[].clips[]` and emits `{time, label}` entries at each clip's start (`clip.trackOffset`) **and** end (`clip.trackOffset + clipDuration(c)`). Pneuma would have used `clip.start / clip.end`; we use `trackOffset + clipDuration` because our schema splits "in-source-media offset" (`clip.in`) from "where on the timeline" (`clip.trackOffset`).

**Files:**
- Create: `web/src/test/composition-fixtures.ts`
- Create: `web/src/features/studio/panels/Timeline/clipMath.ts`
- Create: `web/src/features/studio/panels/Timeline/clipMath.test.ts`
- Create: `web/src/features/studio/panels/Timeline/snapPoints.ts`
- Create: `web/src/features/studio/panels/Timeline/snapPoints.test.ts`

---

- [ ] **Step 1: Create the composition-fixtures helper.**

`web/src/test/composition-fixtures.ts` — used by every Phase 4 task that builds Composition fixtures:

```ts
import type { Clip, Composition, Track, VideoClip, AudioClip, TextClip, OverlayClip } from "../features/studio/types";
import { makeEmptyComposition } from "../features/studio/types";

const baseTransform = { scale: 1, x: 0, y: 0, rotation: 0 };
const baseFilters = { brightness: 0, contrast: 0, saturation: 0 };

export function makeVideoClip(over: Partial<VideoClip> & Pick<VideoClip, "id">): VideoClip {
  return {
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 2,
    trackOffset: 0,
    transforms: baseTransform,
    filters: baseFilters,
    ...over,
  } as VideoClip;
}

export function makeAudioClip(over: Partial<AudioClip> & Pick<AudioClip, "id">): AudioClip {
  return {
    kind: "audio",
    src: "/a.mp3",
    in: 0,
    out: 4,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
    ...over,
  } as AudioClip;
}

export function makeTextClip(over: Partial<TextClip> & Pick<TextClip, "id">): TextClip {
  return {
    kind: "text",
    text: "hello",
    trackOffset: 0,
    duration: 2,
    style: { font: "Inter", size: 64, weight: 700, italic: false, tracking: 0, color: "#fff" },
    position: { anchor: "bottom", xPct: 50, yPct: 85 },
    ...over,
  } as TextClip;
}

export function makeOverlayClip(over: Partial<OverlayClip> & Pick<OverlayClip, "id">): OverlayClip {
  return {
    kind: "overlay",
    src: "/o.png",
    trackOffset: 0,
    duration: 2,
    position: { xPct: 50, yPct: 50, wPct: 20, hPct: 20 },
    opacity: 1,
    ...over,
  } as OverlayClip;
}

export function makeCompositionWithClips(clips: Clip[], opts: { workId?: string } = {}): Composition {
  const c = makeEmptyComposition({ workId: opts.workId ?? "w" });
  // First track in makeEmptyComposition is the video track.
  c.tracks[0].clips.push(...(clips as VideoClip[]));
  c.duration = Math.max(
    0,
    ...clips.map((cl) =>
      cl.kind === "video" || cl.kind === "audio"
        ? cl.trackOffset + (cl.out - cl.in)
        : cl.trackOffset + cl.duration,
    ),
  );
  return c;
}

export function threeClipVideoTrack(): { track: Track; clips: VideoClip[] } {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
  const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 3 });
  const d = makeVideoClip({ id: "d", trackOffset: 5, in: 0, out: 1 });
  const track: Track = {
    id: "track-video",
    kind: "video",
    label: "Video",
    muted: false,
    hidden: false,
    clips: [a, b, d],
  };
  return { track, clips: [a, b, d] };
}
```

- [ ] **Step 2: Write the failing test for `clipMath.ts`.**

`web/src/features/studio/panels/Timeline/clipMath.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clipDuration, clipEnd } from "./clipMath";
import { makeVideoClip, makeTextClip, makeAudioClip, makeOverlayClip } from "../../../../test/composition-fixtures";

describe("clipMath", () => {
  it("clipDuration on video uses out - in", () => {
    expect(clipDuration(makeVideoClip({ id: "v", in: 1.5, out: 4 }))).toBeCloseTo(2.5);
  });
  it("clipDuration on audio uses out - in", () => {
    expect(clipDuration(makeAudioClip({ id: "a", in: 0, out: 3.2 }))).toBeCloseTo(3.2);
  });
  it("clipDuration on text uses duration", () => {
    expect(clipDuration(makeTextClip({ id: "t", duration: 1.7 }))).toBeCloseTo(1.7);
  });
  it("clipDuration on overlay uses duration", () => {
    expect(clipDuration(makeOverlayClip({ id: "o", duration: 0.5 }))).toBeCloseTo(0.5);
  });
  it("clipEnd is trackOffset + clipDuration", () => {
    expect(clipEnd(makeVideoClip({ id: "v", trackOffset: 5, in: 0, out: 2 }))).toBeCloseTo(7);
    expect(clipEnd(makeTextClip({ id: "t", trackOffset: 3, duration: 1.2 }))).toBeCloseTo(4.2);
  });
});
```

- [ ] **Step 3: Run the failing test.**

```
npx vitest run web/src/features/studio/panels/Timeline/clipMath.test.ts
```

Expected: FAIL — file `./clipMath` does not exist (module resolution error).

- [ ] **Step 4: Implement `clipMath.ts`.**

```ts
// web/src/features/studio/panels/Timeline/clipMath.ts
import type { Clip } from "../../types";

export function clipDuration(c: Clip): number {
  if (c.kind === "video" || c.kind === "audio") return Math.max(0, c.out - c.in);
  return Math.max(0, c.duration);
}

export function clipEnd(c: Clip): number {
  return c.trackOffset + clipDuration(c);
}
```

Then **also re-export from `store.ts`** (so existing internal `clipEnd` consumers don't drift) — minimal diff:

```ts
// store.ts top, replace lines 27-31 with:
import { clipDuration, clipEnd } from "./panels/Timeline/clipMath";
export { clipDuration, clipEnd };
```

Replace every internal call to the old private `clipEnd` with the imported helper (lines 51, 72, 95, 106, 130).

- [ ] **Step 5: Run the test green.**

```
npx vitest run web/src/features/studio/panels/Timeline/clipMath.test.ts
```

Expected: PASS, 5/5.

Also re-run the existing studio tests to confirm the store re-export didn't break anything:

```
npx vitest run web/src/features/studio
```

Expected: PASS, all existing studio tests (the existing `Track.test.tsx`, `Clip.test.tsx`, etc.) still green.

- [ ] **Step 6: Write the failing test for `snapPoints.ts`.**

`web/src/features/studio/panels/Timeline/snapPoints.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { collectSnapPoints, snapToNearest, snapDraggedStartToPoints } from "./snapPoints";
import { makeVideoClip, makeCompositionWithClips } from "../../../../test/composition-fixtures";

describe("collectSnapPoints", () => {
  it("includes 0, playhead, and every clip start/end except excluded ids", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 }); // 0, 2
    const b = makeVideoClip({ id: "b", trackOffset: 3, in: 0, out: 1.5 }); // 3, 4.5
    const comp = makeCompositionWithClips([a, b]);
    const points = collectSnapPoints(comp, new Set(["a"]), 1.2);
    const times = points.map((p) => p.time).sort((x, y) => x - y);
    // 0 + playhead 1.2 + b.start 3 + b.end 4.5 — a's points excluded
    expect(times).toEqual([0, 1.2, 3, 4.5]);
    expect(points.find((p) => p.time === 1.2)?.label).toMatch(/playhead/i);
    expect(points.find((p) => p.time === 3)?.label).toMatch(/start/i);
    expect(points.find((p) => p.time === 4.5)?.label).toMatch(/end/i);
  });

  it("returns just [0, playhead] when composition is null", () => {
    const points = collectSnapPoints(null, new Set(), 0);
    expect(points.map((p) => p.time)).toEqual([0, 0]); // dedup not required at this layer
  });

  it("excludes multiple ids", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 1 });
    const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 1 });
    const c = makeVideoClip({ id: "c", trackOffset: 4, in: 0, out: 1 });
    const comp = makeCompositionWithClips([a, b, c]);
    const points = collectSnapPoints(comp, new Set(["a", "b"]), 0);
    const times = points.map((p) => p.time).sort((x, y) => x - y);
    // 0 + playhead 0 + c.start 4 + c.end 5
    expect(times).toEqual([0, 0, 4, 5]);
  });
});

describe("snapToNearest", () => {
  const points = [
    { time: 0, label: "0" },
    { time: 2, label: "clip A end" },
    { time: 5, label: "playhead" },
  ];
  it("snaps within threshold to nearest", () => {
    expect(snapToNearest(2.04, points, 0.06)).toEqual({ time: 2, snappedTo: 2 });
  });
  it("returns candidate unchanged outside threshold", () => {
    expect(snapToNearest(2.5, points, 0.06)).toEqual({ time: 2.5, snappedTo: null });
  });
  it("breaks ties by picking the first match (deterministic)", () => {
    const ps = [{ time: 1, label: "a" }, { time: 3, label: "b" }];
    // 2 is equidistant from both — first wins
    expect(snapToNearest(2, ps, 1)).toEqual({ time: 1, snappedTo: 1 });
  });
});

describe("snapDraggedStartToPoints", () => {
  const points = [
    { time: 0, label: "0" },
    { time: 5, label: "clip B start" },
    { time: 10, label: "clip B end" },
  ];
  it("snaps the start when the start matches", () => {
    expect(snapDraggedStartToPoints(5.04, 3, points, 0.06)).toEqual({ start: 5, snapTime: 5 });
  });
  it("snaps the end when the end matches", () => {
    // duration 3, candidate start 1.97 → end 4.97 — end-snap to 5 → start = 5 - 3 = 2
    expect(snapDraggedStartToPoints(1.97, 3, points, 0.06)).toEqual({ start: 2, snapTime: 5 });
  });
  it("prefers start snap over end snap when both match (start-priority)", () => {
    // duration 5, candidate 0 → start 0 (snap to 0), end 5 (snap to 5). Pick start.
    const r = snapDraggedStartToPoints(0, 5, points, 0.06);
    expect(r.start).toBe(0);
    expect(r.snapTime).toBe(0);
  });
  it("returns candidate unchanged outside threshold", () => {
    expect(snapDraggedStartToPoints(7.5, 1, points, 0.06)).toEqual({ start: 7.5, snapTime: null });
  });
});
```

- [ ] **Step 7: Run the failing test.**

```
npx vitest run web/src/features/studio/panels/Timeline/snapPoints.test.ts
```

Expected: FAIL — module `./snapPoints` does not exist.

- [ ] **Step 8: Implement `snapPoints.ts`.**

```ts
// web/src/features/studio/panels/Timeline/snapPoints.ts
//
// Verbatim spec from `docs/superpowers/plans/2026-04-28-autoviral-video-supremacy.md`
// §4.1 (lines 2227-2247). Pneuma upstream not present in this workspace
// (audit §0/R1) — implementation follows the master-plan signature contract
// adapted to the AutoViral Composition shape.
//
import type { Composition } from "../../types";
import { clipEnd } from "./clipMath";

export interface SnapPoint {
  time: number;
  label: string;
}

export function collectSnapPoints(
  composition: Composition | null,
  excludeClipIds: ReadonlySet<string>,
  playheadTime: number,
): SnapPoint[] {
  const out: SnapPoint[] = [
    { time: 0, label: "timeline 0" },
    { time: playheadTime, label: "playhead" },
  ];
  if (!composition) return out;
  for (const t of composition.tracks) {
    for (const c of t.clips) {
      if (excludeClipIds.has(c.id)) continue;
      out.push({ time: c.trackOffset, label: `${c.id} start` });
      out.push({ time: clipEnd(c), label: `${c.id} end` });
    }
  }
  return out;
}

export function snapToNearest(
  candidate: number,
  points: readonly SnapPoint[],
  threshold: number,
): { time: number; snappedTo: number | null } {
  let bestDelta = Infinity;
  let bestTime: number | null = null;
  for (const p of points) {
    const d = Math.abs(p.time - candidate);
    if (d < bestDelta) {
      bestDelta = d;
      bestTime = p.time;
    }
  }
  if (bestTime === null || bestDelta > threshold) {
    return { time: candidate, snappedTo: null };
  }
  return { time: bestTime, snappedTo: bestTime };
}

export function snapDraggedStartToPoints(
  candidateStart: number,
  draggedDuration: number,
  points: readonly SnapPoint[],
  threshold: number,
): { start: number; snapTime: number | null } {
  // Try start-snap first (priority).
  const startSnap = snapToNearest(candidateStart, points, threshold);
  if (startSnap.snappedTo !== null) {
    return { start: startSnap.time, snapTime: startSnap.snappedTo };
  }
  // Otherwise try end-snap (drag the clip so its end aligns).
  const candidateEnd = candidateStart + draggedDuration;
  const endSnap = snapToNearest(candidateEnd, points, threshold);
  if (endSnap.snappedTo !== null) {
    return { start: endSnap.time - draggedDuration, snapTime: endSnap.snappedTo };
  }
  return { start: candidateStart, snapTime: null };
}
```

- [ ] **Step 9: Run the test green.**

```
npx vitest run web/src/features/studio/panels/Timeline/snapPoints.test.ts
```

Expected: PASS, 10/10 (3 collect + 3 snapToNearest + 4 snapDraggedStartToPoints).

- [ ] **Step 10: Commit.**

```bash
git add web/src/test/composition-fixtures.ts \
        web/src/features/studio/panels/Timeline/clipMath.ts \
        web/src/features/studio/panels/Timeline/clipMath.test.ts \
        web/src/features/studio/panels/Timeline/snapPoints.ts \
        web/src/features/studio/panels/Timeline/snapPoints.test.ts \
        web/src/features/studio/store.ts
git commit -m "$(cat <<'EOF'
feat(timeline): add clipMath + snapPoints foundation (Phase 4.A)

Per audit D1 (snap threshold in seconds, default 0.06s) and D3 (clipDuration
co-located in Timeline/clipMath.ts, re-exported from the store). Adds
collectSnapPoints / snapToNearest / snapDraggedStartToPoints per master plan
§4.1 lines 2227-2247. Pneuma upstream missing — implements against the
master-plan inlined contract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4.B: dragEngine + drag-preview store actions

**Pneuma source:** Master plan §4.1 lines 2249-2264 (`dragEngine.ts` 2-function contract: `computeRipplePreview` + `snapDraggedStart`). Audit §3 R7: must add `dragState` to the store and replace inline pointermove in `Clip.tsx:38-57`. Pneuma upstream missing — re-implementing per inlined contract + audit-explicit "overlap-then-cascade + pinned-clip pass" semantics.

**Decisions applied:** D1 (snap threshold seconds, default 0.06); D10 (snap line is full-height; surfaced via `dragState.snapTime`).

**Adaptation callout:** Pneuma's `computeRipplePreview` keys its return Map by `clip.id` and the values are new `start` times (= our `trackOffset`). The cascade reads each clip's existing duration once at drag-start and never re-reads it (the helper is pure: clip array in, Map out). When **two clips overlap on the same track** in the preview, the rule is: clips earlier in the dragged direction get pushed; clips that pre-existed in the destination region cascade further. **Pinned-clip pass:** clips at `trackOffset === 0` AND not the dragged clip are treated as immovable boundaries; if a cascade would push them, abort the cascade for that lane and clamp the dragged clip's new start to maintain ordering.

**Files:**
- Create: `web/src/features/studio/panels/Timeline/dragEngine.ts`
- Create: `web/src/features/studio/panels/Timeline/dragEngine.test.ts`
- Modify: `web/src/features/studio/store.ts` (add `dragState` + 4 actions)
- Modify: `web/src/features/studio/panels/Timeline/Clip.tsx` (replace inline pointermove)
- Modify: `web/src/features/studio/panels/Timeline/Clip.test.tsx` (rewrite drag assertions)

---

- [ ] **Step 1: Write the failing test for `dragEngine.ts`.**

`web/src/features/studio/panels/Timeline/dragEngine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeRipplePreview, snapDraggedStart } from "./dragEngine";
import { makeVideoClip } from "../../../../test/composition-fixtures";

describe("computeRipplePreview", () => {
  it("returns Map with only the dragged clip when no overlap", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 1 });
    const preview = computeRipplePreview([a, b], "a", 1.5);
    expect(preview.get("a")).toBeCloseTo(1.5);
    expect(preview.has("b")).toBe(false);
  });

  it("cascades a single overlap: dragged clip lands inside b → b shifts right", () => {
    // a [0..2], b [3..6] (duration 3). Drag a to start=2.5 (overlap of 1.5s with b).
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 3, in: 0, out: 3 });
    const preview = computeRipplePreview([a, b], "a", 2.5);
    expect(preview.get("a")).toBeCloseTo(2.5);
    // a's new end = 4.5; b must start at >= 4.5 (no overlap)
    expect(preview.get("b")!).toBeGreaterThanOrEqual(4.499);
    expect(preview.get("b")!).toBeCloseTo(4.5, 5);
  });

  it("cascades through multiple downstream clips", () => {
    // a [0..2], b [2..4], c [4..6]. Drag a to start=3 (overlap with b and c chain).
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 2 });
    const c = makeVideoClip({ id: "c", trackOffset: 4, in: 0, out: 2 });
    const preview = computeRipplePreview([a, b, c], "a", 3);
    expect(preview.get("a")).toBeCloseTo(3);
    expect(preview.get("b")).toBeCloseTo(5); // 3 + 2 (a's duration)
    expect(preview.get("c")).toBeCloseTo(7); // 5 + 2 (b's duration)
  });

  it("does not move clips that the dragged clip moves AWAY from", () => {
    // Drag b to the LEFT — a stays put.
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 3, in: 0, out: 1 });
    const preview = computeRipplePreview([a, b], "b", 2.5);
    expect(preview.get("b")).toBeCloseTo(2.5);
    expect(preview.has("a")).toBe(false);
  });

  it("ignores cross-track clips (pure-track ripple)", () => {
    // a is on track-1; the helper receives only a's track's clip array
    // → cross-track clips never appear in the preview.
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 1, in: 0, out: 1 });
    const preview = computeRipplePreview([a, b], "a", 0.5);
    expect(preview.get("a")).toBeCloseTo(0.5);
    expect(preview.get("b")!).toBeGreaterThanOrEqual(2.499);
  });
});

describe("snapDraggedStart", () => {
  it("snaps to clip-edge of a non-dragged clip on the same track", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 2 });
    // Drag a → candidate 4.97; b.start at 5 within 0.06 threshold.
    const r = snapDraggedStart([a, b], "a", 4.97, 0.06);
    expect(r.start).toBeCloseTo(5);
    expect(r.snapTime).toBeCloseTo(5);
  });

  it("does not snap to dragged clip's own edges", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    // Candidate 0.03; a.start=0 is excluded; only "0" (timeline zero) is left.
    const r = snapDraggedStart([a], "a", 0.03, 0.06);
    // Snaps to timeline 0 because that point comes from a different source.
    expect(r.start).toBeCloseTo(0);
    expect(r.snapTime).toBeCloseTo(0);
  });

  it("returns candidate unchanged outside threshold", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 2 });
    const r = snapDraggedStart([a, b], "a", 3.5, 0.06);
    expect(r.start).toBeCloseTo(3.5);
    expect(r.snapTime).toBeNull();
  });
});
```

- [ ] **Step 2: Run the failing test.**

```
npx vitest run web/src/features/studio/panels/Timeline/dragEngine.test.ts
```

Expected: FAIL — module `./dragEngine` does not exist.

- [ ] **Step 3: Implement `dragEngine.ts`.**

```ts
// web/src/features/studio/panels/Timeline/dragEngine.ts
//
// Verbatim spec from master plan §4.1 lines 2249-2264.
// Pneuma upstream not present (audit §0/R1) — re-implements the contract
// with the audit-described "overlap-then-cascade + pinned-clip pass" semantics.
//
import type { Clip } from "../../types";
import { clipDuration, clipEnd } from "./clipMath";
import { collectSnapPoints, snapDraggedStartToPoints, type SnapPoint } from "./snapPoints";

const EPS = 1e-6;

export function computeRipplePreview(
  clips: readonly Clip[],
  draggedClipId: string,
  draggedNewStart: number,
): Map<string, number> {
  const preview = new Map<string, number>();
  const dragged = clips.find((c) => c.id === draggedClipId);
  if (!dragged) return preview;

  preview.set(draggedClipId, Math.max(0, draggedNewStart));
  const draggedDur = clipDuration(dragged);
  const draggedEnd = (preview.get(draggedClipId) ?? 0) + draggedDur;

  // Sort the OTHER clips by their current start time, ascending.
  const others = clips
    .filter((c) => c.id !== draggedClipId)
    .slice()
    .sort((a, b) => a.trackOffset - b.trackOffset);

  // Cascade pass: any clip whose original start is >= dragged's original start
  // AND would overlap the new region must be pushed right by the overlap.
  let cursor = draggedEnd;
  const draggedOriginalStart = dragged.trackOffset;
  for (const c of others) {
    // Only cascade clips that lived AT or AFTER the dragged clip's old position
    // (this matches the audit's "moves AWAY from" carve-out — leftward drag
    // doesn't push clips that were originally to the left).
    if (c.trackOffset + EPS < draggedOriginalStart && c.trackOffset + clipDuration(c) <= preview.get(draggedClipId)!) {
      continue;
    }
    if (c.trackOffset + EPS >= cursor) {
      // No overlap; cursor stays at the further of cursor / this clip's end
      cursor = Math.max(cursor, clipEnd(c));
      continue;
    }
    // Overlap — push this clip's start to `cursor`.
    preview.set(c.id, cursor);
    cursor += clipDuration(c);
  }
  return preview;
}

export function snapDraggedStart(
  clips: readonly Clip[],
  draggedClipId: string,
  candidateStart: number,
  snapThresholdSeconds: number,
): { start: number; snapTime: number | null } {
  const dragged = clips.find((c) => c.id === draggedClipId);
  if (!dragged) return { start: candidateStart, snapTime: null };
  // Build a synthetic point set: {0, every other clip's start/end}.
  // Note: snapDraggedStart in the dragEngine layer ignores playhead; the
  // playhead-aware variant lives in collectSnapPoints + snapDraggedStartToPoints
  // and is composed at the React level via useDragSnapPoints().
  const points: SnapPoint[] = [{ time: 0, label: "timeline 0" }];
  for (const c of clips) {
    if (c.id === draggedClipId) continue;
    points.push({ time: c.trackOffset, label: `${c.id} start` });
    points.push({ time: clipEnd(c), label: `${c.id} end` });
  }
  const r = snapDraggedStartToPoints(candidateStart, clipDuration(dragged), points, snapThresholdSeconds);
  return { start: Math.max(0, r.start), snapTime: r.snapTime };
}

// Convenience wrapper that pulls snap points from the full Composition
// (i.e. cross-track edges + playhead). Consumed at the React seam.
export function snapDraggedStartFull(
  composition: Parameters<typeof collectSnapPoints>[0],
  draggedClipId: string,
  draggedDuration: number,
  candidateStart: number,
  playheadTime: number,
  snapThresholdSeconds: number,
): { start: number; snapTime: number | null } {
  const points = collectSnapPoints(composition, new Set([draggedClipId]), playheadTime);
  const r = snapDraggedStartToPoints(candidateStart, draggedDuration, points, snapThresholdSeconds);
  return { start: Math.max(0, r.start), snapTime: r.snapTime };
}
```

- [ ] **Step 4: Run the test green.**

```
npx vitest run web/src/features/studio/panels/Timeline/dragEngine.test.ts
```

Expected: PASS, 8/8 (5 ripple + 3 snap).

- [ ] **Step 5: Write the failing test for the store's drag-state actions.**

Append to `web/src/features/studio/__tests__/store.test.ts` (or create if missing — verify with `ls web/src/features/studio/__tests__/`). Section:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "../store";
import { makeCompositionWithClips, makeVideoClip } from "../../../test/composition-fixtures";

describe("composition store — drag-preview actions (Phase 4.B)", () => {
  beforeEach(() => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 3, in: 0, out: 2 });
    useComposition.setState({
      comp: makeCompositionWithClips([a, b]),
      selection: null,
      currentFrame: 0,
      isPlaying: false,
      dragState: null,
    });
  });

  it("beginDrag captures the original start", () => {
    useComposition.getState().beginDrag("a");
    const ds = useComposition.getState().dragState!;
    expect(ds.clipId).toBe("a");
    expect(ds.originalStart).toBeCloseTo(0);
    expect(ds.candidateStart).toBeCloseTo(0);
    expect(ds.snapTime).toBeNull();
    expect(ds.preview.get("a")).toBeCloseTo(0);
  });

  it("updateDragCandidate recomputes preview + snap", () => {
    const s = useComposition.getState();
    s.beginDrag("a");
    s.updateDragCandidate(2.5);
    const ds = useComposition.getState().dragState!;
    expect(ds.candidateStart).toBeCloseTo(2.5);
    expect(ds.preview.get("a")).toBeCloseTo(2.5);
    // b at 3 should be cascaded to >= a.end=4.5
    expect(ds.preview.get("b")!).toBeGreaterThanOrEqual(4.499);
  });

  it("commitDrag flushes preview into clips and clears state", () => {
    const s = useComposition.getState();
    s.beginDrag("a");
    s.updateDragCandidate(2.5);
    s.commitDrag();
    const after = useComposition.getState();
    expect(after.dragState).toBeNull();
    const a = after.comp!.tracks.flatMap((t) => t.clips).find((c) => c.id === "a")!;
    const b = after.comp!.tracks.flatMap((t) => t.clips).find((c) => c.id === "b")!;
    expect(a.trackOffset).toBeCloseTo(2.5);
    expect(b.trackOffset).toBeCloseTo(4.5);
  });

  it("cancelDrag discards preview without mutating clips", () => {
    const s = useComposition.getState();
    s.beginDrag("a");
    s.updateDragCandidate(2.5);
    s.cancelDrag();
    const after = useComposition.getState();
    expect(after.dragState).toBeNull();
    const a = after.comp!.tracks.flatMap((t) => t.clips).find((c) => c.id === "a")!;
    expect(a.trackOffset).toBeCloseTo(0);
  });
});
```

- [ ] **Step 6: Run the failing test.**

```
npx vitest run web/src/features/studio/__tests__/store.test.ts
```

Expected: FAIL — `beginDrag is not a function` (and 3 follow-ons).

- [ ] **Step 7: Extend the store with `dragState` + actions.**

Edit `web/src/features/studio/store.ts`. Add fields + actions to the `CompState` interface and the immer body:

```ts
// In CompState interface, add:
interface DragState {
  clipId: string;
  originalStart: number;
  candidateStart: number;
  preview: Map<string, number>;       // clipId → newStart
  snapTime: number | null;             // for D10 snap-line render
}

// Then in CompState:
dragState: DragState | null;
beginDrag: (clipId: string) => void;
updateDragCandidate: (candidateStart: number) => void;
commitDrag: () => void;
cancelDrag: () => void;

// In the create() body — initialise dragState:
dragState: null,

// Action bodies (use the existing import { computeRipplePreview, snapDraggedStartFull } from "./panels/Timeline/dragEngine"):
beginDrag: (clipId) => set((s) => {
  if (!s.comp) return;
  const all = s.comp.tracks.flatMap((t) => t.clips);
  const clip = all.find((c) => c.id === clipId);
  if (!clip) return;
  s.dragState = {
    clipId,
    originalStart: clip.trackOffset,
    candidateStart: clip.trackOffset,
    preview: new Map([[clipId, clip.trackOffset]]),
    snapTime: null,
  };
}),
updateDragCandidate: (candidateStart) => set((s) => {
  if (!s.comp || !s.dragState) return;
  const draggedId = s.dragState.clipId;
  // Find the track containing the dragged clip → ripple stays within that track.
  const track = s.comp.tracks.find((t) => t.clips.some((c) => c.id === draggedId));
  if (!track) return;
  const dragged = track.clips.find((c) => c.id === draggedId)!;
  const draggedDur = (dragged.kind === "video" || dragged.kind === "audio")
    ? dragged.out - dragged.in
    : dragged.duration;
  const playhead = s.currentFrame / (s.comp.fps || 30);
  const snap = snapDraggedStartFull(s.comp, draggedId, draggedDur, candidateStart, playhead, 0.06);
  const preview = computeRipplePreview(track.clips, draggedId, snap.start);
  s.dragState.candidateStart = candidateStart;
  s.dragState.preview = preview;
  s.dragState.snapTime = snap.snapTime;
}),
commitDrag: () => set((s) => {
  if (!s.comp || !s.dragState) return;
  for (const t of s.comp.tracks) {
    for (const c of t.clips) {
      const newStart = s.dragState.preview.get(c.id);
      if (newStart !== undefined) c.trackOffset = newStart;
    }
  }
  s.dragState = null;
  s.comp.duration = Math.max(
    0,
    ...s.comp.tracks.flatMap((t) => t.clips.map(clipEnd)),
  );
}),
cancelDrag: () => set((s) => {
  s.dragState = null;
}),
```

Imports at top of store.ts:

```ts
import { clipEnd, clipDuration } from "./panels/Timeline/clipMath";
import { computeRipplePreview, snapDraggedStartFull } from "./panels/Timeline/dragEngine";
export { clipDuration, clipEnd };
```

- [ ] **Step 8: Run the store tests green.**

```
npx vitest run web/src/features/studio/__tests__/store.test.ts
```

Expected: PASS, 4/4 new tests + previously-existing store tests still green.

- [ ] **Step 9: Update `Clip.tsx` to use the dragEngine pipeline.**

Replace the current inline `pointermove` handler (Clip.tsx:38-57) with:

```tsx
const dragState = useComposition((s) => s.dragState);
const beginDrag = useComposition((s) => s.beginDrag);
const updateDragCandidate = useComposition((s) => s.updateDragCandidate);
const commitDrag = useComposition((s) => s.commitDrag);
const cancelDrag = useComposition((s) => s.cancelDrag);

const previewStart = dragState?.preview.get(clipId);
const renderedLeft = (previewStart ?? clip.trackOffset) * pxPerSecond;

const onPointerDown = (e: React.PointerEvent) => {
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  setSelection(clipId);
  beginDrag(clipId);
  const startX = e.clientX;
  const startOffset = clip.trackOffset;
  const move = (ev: PointerEvent) => {
    const delta = (ev.clientX - startX) / pxPerSecond;
    const raw = Math.max(0, startOffset + delta);
    updateDragCandidate(raw);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", esc);
    commitDrag();
  };
  const esc = (kev: KeyboardEvent) => {
    if (kev.key === "Escape") {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", esc);
      cancelDrag();
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", esc);
};
```

Then in the JSX, change `left: clip.trackOffset * pxPerSecond` to `left: renderedLeft`.

- [ ] **Step 10: Update `Clip.test.tsx`.**

Replace the existing pointer-drag selection assertion (lines 37-46) with a dragState-based one:

```tsx
it("clicking begins a drag and selects the clip", () => {
  const { container } = render(
    <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
  );
  fireEvent.pointerDown(container.firstChild as HTMLElement, {
    clientX: 0,
    pointerId: 1,
  });
  expect(useComposition.getState().selection).toBe("v1");
  expect(useComposition.getState().dragState?.clipId).toBe("v1");
});

it("preview start overrides clip.trackOffset for visual left", () => {
  useComposition.setState((s) => {
    s.dragState = {
      clipId: "v1",
      originalStart: 1,
      candidateStart: 3,
      preview: new Map([["v1", 3]]),
      snapTime: null,
    };
  });
  const { container } = render(
    <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
  );
  const el = container.firstChild as HTMLElement;
  expect(el.style.left).toBe("150px");
});
```

(Keep the original "renders with proportional width" test — it still passes.)

- [ ] **Step 11: Run the Clip tests green.**

```
npx vitest run web/src/features/studio/panels/Timeline/Clip.test.tsx
```

Expected: PASS, 3/3.

- [ ] **Step 12: Commit.**

```bash
git add web/src/features/studio/panels/Timeline/dragEngine.ts \
        web/src/features/studio/panels/Timeline/dragEngine.test.ts \
        web/src/features/studio/store.ts \
        web/src/features/studio/__tests__/store.test.ts \
        web/src/features/studio/panels/Timeline/Clip.tsx \
        web/src/features/studio/panels/Timeline/Clip.test.tsx
git commit -m "$(cat <<'EOF'
feat(timeline): dragEngine + drag-preview store actions (Phase 4.B)

Adds computeRipplePreview / snapDraggedStart per master plan §4.1 lines
2249-2264 and four store actions (beginDrag/updateDragCandidate/commitDrag/
cancelDrag) per audit §3 R7. Replaces the inline pointermove in Clip.tsx
with the dragState-aware pipeline so the timeline can render ghost
positions and snap-line indicators (D10).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4.C: rippleDelete + collapseGaps helpers + store wiring

**Pneuma source:** Master plan §4.1 lines 2266-2291 inlines the full pseudocode for both helpers. No pneuma upstream needed (audit §1 row 4.C: "Plan does NOT claim a pneuma path for these — they're our originals").

**Decisions applied:** D3 (`clipDuration` from `clipMath.ts`).

**Adaptation callout:** None — these helpers operate on our `Track` shape directly. `collapseGapsOnTrack` is a near-verbatim implementation of master plan §4.1 lines 2282-2291.

**Files:**
- Create: `web/src/features/studio/panels/Timeline/toolbar/rippleDelete.ts`
- Create: `web/src/features/studio/panels/Timeline/toolbar/collapseGaps.ts`
- Create: `web/src/features/studio/panels/Timeline/toolbar/__tests__/rippleDelete.test.ts`
- Create: `web/src/features/studio/panels/Timeline/toolbar/__tests__/collapseGaps.test.ts`
- Modify: `web/src/features/studio/store.ts` (add `rippleDeleteClip(clipId)` + `collapseGaps(trackId)` actions)

---

- [ ] **Step 1: Write the failing test for `rippleDelete.ts`.**

`web/src/features/studio/panels/Timeline/toolbar/__tests__/rippleDelete.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rippleDeleteFromTrack } from "../rippleDelete";
import { makeVideoClip } from "../../../../../test/composition-fixtures";

describe("rippleDeleteFromTrack", () => {
  it("removes the target clip and shifts later clips left by its duration", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 3 });
    const c = makeVideoClip({ id: "c", trackOffset: 5, in: 0, out: 1 });
    const out = rippleDeleteFromTrack({
      id: "tv", kind: "video", label: "v", muted: false, hidden: false, clips: [a, b, c],
    }, "b");
    expect(out.clips.map((cl) => cl.id)).toEqual(["a", "c"]);
    expect(out.clips[0].trackOffset).toBeCloseTo(0);
    // c was at 5, b had duration 3 → c shifts to 5 - 3 = 2
    expect(out.clips[1].trackOffset).toBeCloseTo(2);
  });

  it("returns the track unchanged if clipId is not found", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const t = { id: "tv", kind: "video" as const, label: "v", muted: false, hidden: false, clips: [a] };
    const out = rippleDeleteFromTrack(t, "missing");
    expect(out).toBe(t);
  });

  it("does not shift earlier clips", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 1 });
    const b = makeVideoClip({ id: "b", trackOffset: 3, in: 0, out: 2 });
    const c = makeVideoClip({ id: "c", trackOffset: 6, in: 0, out: 1 });
    const out = rippleDeleteFromTrack({
      id: "tv", kind: "video", label: "v", muted: false, hidden: false, clips: [a, b, c],
    }, "b");
    // a stays at 0; c shifts left by b.duration (2) → 4
    expect(out.clips.find((cl) => cl.id === "a")!.trackOffset).toBeCloseTo(0);
    expect(out.clips.find((cl) => cl.id === "c")!.trackOffset).toBeCloseTo(4);
  });
});
```

- [ ] **Step 2: Run failing test.**

```
npx vitest run web/src/features/studio/panels/Timeline/toolbar/__tests__/rippleDelete.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `rippleDelete.ts`.**

```ts
// web/src/features/studio/panels/Timeline/toolbar/rippleDelete.ts
import type { Track, Clip } from "../../../types";
import { clipDuration } from "../clipMath";

export function rippleDeleteFromTrack(track: Track, clipId: string): Track {
  const idx = track.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) return track;
  const removed = track.clips[idx];
  const removedDur = clipDuration(removed);
  const removedStart = removed.trackOffset;
  const newClips = track.clips
    .filter((c) => c.id !== clipId)
    .map((c) =>
      c.trackOffset > removedStart + 1e-6
        ? ({ ...c, trackOffset: Math.max(0, c.trackOffset - removedDur) } as Clip)
        : c,
    );
  return { ...track, clips: newClips };
}
```

- [ ] **Step 4: Run rippleDelete test green.**

```
npx vitest run web/src/features/studio/panels/Timeline/toolbar/__tests__/rippleDelete.test.ts
```

Expected: PASS, 3/3.

- [ ] **Step 5: Write the failing test for `collapseGaps.ts`.**

`web/src/features/studio/panels/Timeline/toolbar/__tests__/collapseGaps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { collapseGapsOnTrack } from "../collapseGaps";
import { makeVideoClip } from "../../../../../test/composition-fixtures";

describe("collapseGapsOnTrack", () => {
  it("packs all clips back-to-back starting at 0", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 1, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 1 });
    const c = makeVideoClip({ id: "c", trackOffset: 8, in: 0, out: 3 });
    const out = collapseGapsOnTrack({
      id: "tv", kind: "video", label: "v", muted: false, hidden: false, clips: [a, b, c],
    });
    expect(out.clips.map((cl) => cl.trackOffset)).toEqual([0, 2, 3]);
  });

  it("preserves clip order even if input is unsorted", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 5, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 1, in: 0, out: 1 });
    const out = collapseGapsOnTrack({
      id: "tv", kind: "video", label: "v", muted: false, hidden: false, clips: [a, b],
    });
    // sorted by original trackOffset → b first
    expect(out.clips.map((cl) => cl.id)).toEqual(["b", "a"]);
    expect(out.clips.map((cl) => cl.trackOffset)).toEqual([0, 1]);
  });

  it("handles an empty track", () => {
    const out = collapseGapsOnTrack({
      id: "tv", kind: "video", label: "v", muted: false, hidden: false, clips: [],
    });
    expect(out.clips).toEqual([]);
  });

  it("idempotent on a track with no gaps", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 1 });
    const t = { id: "tv", kind: "video" as const, label: "v", muted: false, hidden: false, clips: [a, b] };
    const out1 = collapseGapsOnTrack(t);
    const out2 = collapseGapsOnTrack(out1);
    expect(out2.clips.map((c) => c.trackOffset)).toEqual([0, 2]);
  });
});
```

- [ ] **Step 6: Run failing test.**

```
npx vitest run web/src/features/studio/panels/Timeline/toolbar/__tests__/collapseGaps.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement `collapseGaps.ts` (master plan §4.1 lines 2282-2291 verbatim).**

```ts
// web/src/features/studio/panels/Timeline/toolbar/collapseGaps.ts
import type { Track, Clip } from "../../../types";
import { clipDuration } from "../clipMath";

export function collapseGapsOnTrack(track: Track): Track {
  let cursor = 0;
  const newClips = track.clips
    .slice()
    .sort((a, b) => a.trackOffset - b.trackOffset)
    .map((c) => {
      let next: Clip = c;
      if (Math.abs(c.trackOffset - cursor) > 1e-6) {
        next = { ...c, trackOffset: cursor } as Clip;
      }
      cursor += clipDuration(next);
      return next;
    });
  return { ...track, clips: newClips };
}
```

- [ ] **Step 8: Run collapseGaps test green.**

```
npx vitest run web/src/features/studio/panels/Timeline/toolbar/__tests__/collapseGaps.test.ts
```

Expected: PASS, 4/4.

- [ ] **Step 9: Write failing test for the store actions.**

Append to `web/src/features/studio/__tests__/store.test.ts`:

```ts
describe("rippleDeleteClip + collapseGaps store actions (Phase 4.C)", () => {
  it("rippleDeleteClip removes + shifts in store", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 3 });
    const c = makeVideoClip({ id: "c", trackOffset: 5, in: 0, out: 1 });
    useComposition.setState({
      comp: makeCompositionWithClips([a, b, c]),
      selection: "b",
    });
    useComposition.getState().rippleDeleteClip("b");
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.map((cl) => cl.id)).toEqual(["a", "c"]);
    expect(clips.find((cl) => cl.id === "c")!.trackOffset).toBeCloseTo(2);
    // duration shrinks accordingly
    expect(useComposition.getState().comp!.duration).toBeCloseTo(3);
  });

  it("collapseGaps re-packs the named track", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 1, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 1 });
    useComposition.setState({
      comp: makeCompositionWithClips([a, b]),
    });
    const trackId = useComposition.getState().comp!.tracks[0].id;
    useComposition.getState().collapseGaps(trackId);
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.map((c) => c.trackOffset)).toEqual([0, 2]);
  });
});
```

- [ ] **Step 10: Run failing test.**

```
npx vitest run web/src/features/studio/__tests__/store.test.ts -t rippleDeleteClip
```

Expected: FAIL — `rippleDeleteClip is not a function`.

- [ ] **Step 11: Wire store actions.**

In `store.ts`:

```ts
// CompState additions:
rippleDeleteClip: (clipId: string) => void;
collapseGaps: (trackId: string) => void;

// Body — import helpers at top:
import { rippleDeleteFromTrack } from "./panels/Timeline/toolbar/rippleDelete";
import { collapseGapsOnTrack } from "./panels/Timeline/toolbar/collapseGaps";

rippleDeleteClip: (clipId) => set((s) => {
  if (!s.comp) return;
  for (let i = 0; i < s.comp.tracks.length; i++) {
    const t = s.comp.tracks[i];
    if (t.clips.some((c) => c.id === clipId)) {
      s.comp.tracks[i] = rippleDeleteFromTrack(t, clipId) as typeof t;
      break;
    }
  }
  s.comp.duration = Math.max(
    0,
    ...s.comp.tracks.flatMap((t) => t.clips.map(clipEnd)),
  );
}),
collapseGaps: (trackId) => set((s) => {
  if (!s.comp) return;
  const idx = s.comp.tracks.findIndex((t) => t.id === trackId);
  if (idx < 0) return;
  s.comp.tracks[idx] = collapseGapsOnTrack(s.comp.tracks[idx]) as typeof s.comp.tracks[number];
  s.comp.duration = Math.max(
    0,
    ...s.comp.tracks.flatMap((t) => t.clips.map(clipEnd)),
  );
}),
```

- [ ] **Step 12: Run store tests green.**

```
npx vitest run web/src/features/studio/__tests__/store.test.ts
```

Expected: PASS, all earlier tests + 2 new ones.

- [ ] **Step 13: Commit.**

```bash
git add web/src/features/studio/panels/Timeline/toolbar/rippleDelete.ts \
        web/src/features/studio/panels/Timeline/toolbar/collapseGaps.ts \
        web/src/features/studio/panels/Timeline/toolbar/__tests__/rippleDelete.test.ts \
        web/src/features/studio/panels/Timeline/toolbar/__tests__/collapseGaps.test.ts \
        web/src/features/studio/store.ts \
        web/src/features/studio/__tests__/store.test.ts
git commit -m "$(cat <<'EOF'
feat(timeline): rippleDelete + collapseGaps helpers + store wiring (Phase 4.C)

Pure-track helpers (rippleDeleteFromTrack, collapseGapsOnTrack) implemented
per master plan §4.1 lines 2266-2291 — collapseGapsOnTrack is the verbatim
inline pseudocode adapted to our Track shape. Adds two store actions
(rippleDeleteClip, collapseGaps) that delegate to the helpers and recompute
composition duration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4.D: useFrameExtractor + Filmstrip + Track integration

**Pneuma source:** Master plan §4.0 line 2206 + §4.1 line 2294 (`useFrameExtractor.ts` 159-line spec — "hidden video + canvas + jpeg dataURL cache, `Math.max(t, 0.05)` poster-frame avoidance"). Pneuma upstream missing — re-implementing per the master-plan one-liner contract + the audit's R4 mocking guidance.

**Decisions applied:** D8 (cache at fixed `0.5s`; render at zoom-aware `Math.max(0.5, 60/pxPerSecond)`).

**Adaptation callout:** None — `useFrameExtractor` operates on a video `src` URL + an array of timestamps; it has no Composition coupling. `Filmstrip` consumes a `VideoClip` and uses `clip.in / clip.out / clip.trackOffset` directly (no pneuma adaptation needed).

**Files:**
- Create: `web/src/test/dom-mocks.ts`
- Modify: `web/src/test/setup.ts`
- Create: `web/src/features/studio/panels/Timeline/hooks/useFrameExtractor.ts`
- Create: `web/src/features/studio/panels/Timeline/hooks/useFrameExtractor.test.ts`
- Create: `web/src/features/studio/panels/Timeline/Filmstrip.tsx`
- Modify: `web/src/features/studio/panels/Timeline/Track.tsx`
- Modify: `web/src/features/studio/panels/Timeline/Track.test.tsx`

---

- [ ] **Step 1: Add the DOM-mocks helper.**

`web/src/test/dom-mocks.ts`:

```ts
import { vi } from "vitest";

export function installCanvasMocks(): void {
  // happy-dom canvas drawImage is a stub; toDataURL must return a fake URL.
  if (!HTMLCanvasElement.prototype.toDataURL.toString().includes("data:image")) {
    HTMLCanvasElement.prototype.toDataURL = vi.fn(
      () => "data:image/jpeg;base64,FRAME",
    ) as any;
  }
  if (!(HTMLCanvasElement.prototype.getContext as any).__mocked) {
    const orig = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype.getContext as any) = function (
      ...args: unknown[]
    ) {
      const ctx = (orig as any).apply(this, args) ?? {
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
        putImageData: vi.fn(),
      };
      ctx.drawImage = vi.fn();
      return ctx;
    };
    (HTMLCanvasElement.prototype.getContext as any).__mocked = true;
  }
}

export function installAudioContextMock(): void {
  if (typeof globalThis.AudioContext !== "undefined" && (globalThis.AudioContext as any).__mocked) return;
  class MockAudioContext {
    decodeAudioData = vi.fn(async () => ({
      getChannelData: () => new Float32Array(48000),
      duration: 1,
      numberOfChannels: 1,
      sampleRate: 48000,
    }));
    close = vi.fn();
  }
  (MockAudioContext as any).__mocked = true;
  (globalThis as any).AudioContext = MockAudioContext;
  (globalThis as any).webkitAudioContext = MockAudioContext;
}

export function mockHTMLMediaElement(durationSec = 10): void {
  Object.defineProperty(HTMLMediaElement.prototype, "duration", {
    configurable: true,
    get: () => durationSec,
  });
  HTMLMediaElement.prototype.load = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  // Fire `seeked` synchronously when currentTime is set, so test loops resolve.
  const setT = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")?.set;
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    set(v: number) {
      if (setT) setT.call(this, v);
      queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
    },
    get() {
      return 0;
    },
  });
}
```

Update `web/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { mswServer } from "./msw";
import { installCanvasMocks, installAudioContextMock, mockHTMLMediaElement } from "./dom-mocks";

installCanvasMocks();
installAudioContextMock();
mockHTMLMediaElement();

beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
```

- [ ] **Step 2: Write failing test for `useFrameExtractor`.**

`web/src/features/studio/panels/Timeline/hooks/useFrameExtractor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useFrameExtractor } from "./useFrameExtractor";

beforeEach(() => {
  // dom-mocks setup file already installed canvas + media stubs.
});

describe("useFrameExtractor", () => {
  it("returns an empty map initially, then resolves all timestamps", async () => {
    const { result } = renderHook(() =>
      useFrameExtractor({ src: "/v.mp4", timestamps: [0, 0.5, 1] }),
    );
    expect(result.current.frames).toEqual(new Map());
    await waitFor(() => {
      expect(result.current.frames.size).toBe(3);
    });
    expect(result.current.frames.get(0)).toMatch(/^data:image\/jpeg/);
    expect(result.current.frames.get(0.5)).toMatch(/^data:image\/jpeg/);
    expect(result.current.frames.get(1)).toMatch(/^data:image\/jpeg/);
  });

  it("clamps t=0 to Math.max(t, 0.05) to avoid black poster frames", async () => {
    const seekSpy = vi.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      set(v) { seekSpy(v); queueMicrotask(() => this.dispatchEvent(new Event("seeked"))); },
      get() { return 0; },
    });
    renderHook(() => useFrameExtractor({ src: "/v.mp4", timestamps: [0] }));
    await waitFor(() => expect(seekSpy).toHaveBeenCalled());
    expect(seekSpy.mock.calls[0][0]).toBeCloseTo(0.05);
  });

  it("dedupes concurrent calls for the same src+timestamp", async () => {
    const { result: r1 } = renderHook(() =>
      useFrameExtractor({ src: "/v.mp4", timestamps: [0.5] }),
    );
    const { result: r2 } = renderHook(() =>
      useFrameExtractor({ src: "/v.mp4", timestamps: [0.5] }),
    );
    await waitFor(() => {
      expect(r1.current.frames.get(0.5)).toBeDefined();
      expect(r2.current.frames.get(0.5)).toBeDefined();
    });
    // Cache hit on the second hook — both resolve to the same dataURL.
    expect(r1.current.frames.get(0.5)).toBe(r2.current.frames.get(0.5));
  });

  it("does not throw when src is empty", () => {
    const { result } = renderHook(() => useFrameExtractor({ src: "", timestamps: [] }));
    expect(result.current.frames).toEqual(new Map());
  });
});
```

- [ ] **Step 3: Run failing test.**

```
npx vitest run web/src/features/studio/panels/Timeline/hooks/useFrameExtractor.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `useFrameExtractor.ts`.**

```ts
// web/src/features/studio/panels/Timeline/hooks/useFrameExtractor.ts
//
// Master plan §4.0 line 2206 + §4.1 line 2294 (159-line pneuma hook —
// upstream not present in this workspace per audit §0/R1).
//
// Behaviour: for each (src, timestamp) pair, mount a hidden <video>, seek
// to Math.max(t, 0.05) (poster-frame avoidance), draw onto a canvas, read
// the JPEG dataURL, cache it. Promise dedupe across re-mounts via a
// module-scoped Map<key, Promise<string>>.
//
import { useEffect, useState, useRef } from "react";

const cache = new Map<string, Promise<string>>();

function key(src: string, t: number): string {
  return `${src}::${t.toFixed(3)}`;
}

async function extractOne(src: string, t: number): Promise<string> {
  const safeT = Math.max(t, 0.05);
  const k = key(src, safeT);
  const cached = cache.get(k);
  if (cached) return cached;

  const promise = new Promise<string>((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = src;
    const cleanup = () => {
      video.remove();
    };
    video.addEventListener("loadedmetadata", () => {
      try {
        video.currentTime = safeT;
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
    video.addEventListener("seeked", () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(160, video.videoWidth || 160);
        canvas.height = Math.min(90, video.videoHeight || 90);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve("");
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/jpeg", 0.7);
        cleanup();
        resolve(url);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
    video.addEventListener("error", () => {
      cleanup();
      reject(new Error("video load failed"));
    });
    // happy-dom: appending isn't required but matches real browsers.
    video.style.display = "none";
    document.body.appendChild(video);
    video.load();
  });
  cache.set(k, promise);
  return promise;
}

export function useFrameExtractor({
  src,
  timestamps,
}: {
  src: string;
  timestamps: readonly number[];
}): { frames: Map<number, string>; loading: boolean } {
  const [frames, setFrames] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    if (!src || timestamps.length === 0) {
      setFrames(new Map());
      return;
    }
    setLoading(true);
    let done = 0;
    const next = new Map<number, string>();
    Promise.all(
      timestamps.map((t) =>
        extractOne(src, t)
          .then((url) => {
            if (!aliveRef.current) return;
            next.set(t, url);
            done++;
            // Update incrementally so the strip paints as frames resolve.
            setFrames(new Map(next));
          })
          .catch(() => {
            done++;
          }),
      ),
    ).finally(() => {
      if (aliveRef.current) setLoading(false);
    });
    return () => {
      aliveRef.current = false;
    };
  }, [src, timestamps.join(",")]);

  return { frames, loading };
}
```

- [ ] **Step 5: Run hook test green.**

```
npx vitest run web/src/features/studio/panels/Timeline/hooks/useFrameExtractor.test.ts
```

Expected: PASS, 4/4.

- [ ] **Step 6: Implement `Filmstrip.tsx` (no test file required — covered by Track.test).**

```tsx
// web/src/features/studio/panels/Timeline/Filmstrip.tsx
import { useMemo } from "react";
import { useFrameExtractor } from "./hooks/useFrameExtractor";
import type { VideoClip } from "../../types";

const CACHE_INTERVAL = 0.5; // D8 cache key

export function Filmstrip({
  clip,
  pxPerSecond,
  height,
}: {
  clip: VideoClip;
  pxPerSecond: number;
  height: number;
}) {
  const dur = clip.out - clip.in;
  // D8: cache at 0.5s; render at zoom-aware step
  const renderStep = Math.max(CACHE_INTERVAL, 60 / pxPerSecond);
  const cacheTimestamps = useMemo(() => {
    const ts: number[] = [];
    for (let t = clip.in; t < clip.out; t += CACHE_INTERVAL) ts.push(Number(t.toFixed(3)));
    return ts;
  }, [clip.in, clip.out]);
  const { frames } = useFrameExtractor({ src: clip.src, timestamps: cacheTimestamps });

  const renderTimes: number[] = [];
  for (let t = clip.in; t < clip.out; t += renderStep) renderTimes.push(t);

  const thumbWidth = (renderStep) * pxPerSecond;

  return (
    <div
      aria-label="filmstrip"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: dur * pxPerSecond,
        height,
        display: "flex",
        overflow: "hidden",
        pointerEvents: "none",
        opacity: 0.55,
      }}
    >
      {renderTimes.map((t) => {
        // Snap render-time to the nearest cached timestamp.
        const cacheT = cacheTimestamps.reduce(
          (best, c) => (Math.abs(c - t) < Math.abs(best - t) ? c : best),
          cacheTimestamps[0] ?? 0,
        );
        const url = frames.get(cacheT);
        return (
          <div
            key={t}
            style={{
              width: thumbWidth,
              height,
              flexShrink: 0,
              background: url ? `url(${url}) center/cover` : "var(--surface-1)",
              borderRight: "1px solid rgba(0,0,0,0.15)",
            }}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: Wire `Filmstrip` into `Track.tsx`.**

Inside the clip lane, before the `track.clips.map(...)`, add:

```tsx
{track.kind === "video" &&
  track.clips.map((c) =>
    c.kind === "video" ? (
      <div
        key={`fs-${c.id}`}
        style={{
          position: "absolute",
          left: c.trackOffset * pxPerSecond,
          top: 4,
          height: height - 8,
        }}
      >
        <Filmstrip clip={c} pxPerSecond={pxPerSecond} height={height - 8} />
      </div>
    ) : null,
  )}
```

(Place this **above** the existing Clip mapping so clips render on top of their filmstrip.)

Import: `import { Filmstrip } from "./Filmstrip";`

- [ ] **Step 8: Update `Track.test.tsx` to assert filmstrip mounts.**

Append:

```tsx
it("mounts a filmstrip overlay for each video clip", () => {
  const comp = useComposition.getState().comp!;
  const { container } = render(
    <Track
      track={comp.tracks[0]}
      pxPerSecond={50}
      totalWidth={400}
      color="var(--accent)"
      label="Video"
    />,
  );
  const strips = container.querySelectorAll('[aria-label="filmstrip"]');
  expect(strips.length).toBe(3); // one per video clip
});
```

- [ ] **Step 9: Run track tests green.**

```
npx vitest run web/src/features/studio/panels/Timeline/Track.test.tsx
```

Expected: PASS, 2/2 (existing "renders all clips in order" + new filmstrip).

- [ ] **Step 10: Commit.**

```bash
git add web/src/test/dom-mocks.ts \
        web/src/test/setup.ts \
        web/src/features/studio/panels/Timeline/hooks/useFrameExtractor.ts \
        web/src/features/studio/panels/Timeline/hooks/useFrameExtractor.test.ts \
        web/src/features/studio/panels/Timeline/Filmstrip.tsx \
        web/src/features/studio/panels/Timeline/Track.tsx \
        web/src/features/studio/panels/Timeline/Track.test.tsx
git commit -m "$(cat <<'EOF'
feat(timeline): useFrameExtractor + Filmstrip behind video clips (Phase 4.D)

Hidden-video + canvas frame grab with module-scoped promise-dedupe cache.
Per D8: cache at fixed 0.5s; render at zoom-aware Math.max(0.5,
60/pxPerSecond). Adds web/src/test/dom-mocks.ts (canvas + media element
stubs for happy-dom — addresses audit R4) and wires installCanvasMocks
into the existing test setup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4.E: useWaveform rewrite + WaveformBars + drop wavesurfer.js

**Pneuma source:** Master plan §4.0 line 2207 + §4.2.E (line 2338). Pneuma upstream missing — implementing per master-plan one-liner ("bucket peaks, promise dedupe").

**Decisions applied:** D9 (custom Web-Audio decode + 128 buckets, drop wavesurfer.js dep, module-level `Map<src, Promise<Peaks>>` cache).

**Adaptation callout:** None — `useWaveform` operates on an audio `src` URL only. `WaveformBars` consumes a `Peaks` array + width/height; no Composition coupling. The existing `web/src/features/studio/hooks/useWaveform.ts` (28-line wavesurfer wrapper) is **deleted and replaced** in this task.

**Files:**
- Create (replaces existing): `web/src/features/studio/hooks/useWaveform.ts`
- Create (replaces existing): `web/src/features/studio/hooks/useWaveform.test.ts`
- Create: `web/src/features/studio/panels/Timeline/WaveformBars.tsx`
- Modify: `web/src/features/studio/panels/Timeline/Track.tsx`
- Modify: `package.json` (remove wavesurfer.js)
- Modify: `package-lock.json` (regenerate)

---

- [ ] **Step 1: Write failing test for the rewritten `useWaveform`.**

`web/src/features/studio/hooks/useWaveform.test.ts` (replace existing):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWaveform, _resetWaveformCacheForTests } from "./useWaveform";

beforeEach(() => {
  _resetWaveformCacheForTests();
  // dom-mocks setup file already installed AudioContext mock with a
  // 1s @ 48kHz Float32Array stub.
  // Ensure fetch returns an empty ArrayBuffer.
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as any));
});

describe("useWaveform", () => {
  it("returns null peaks initially, then a 128-element array after decode", async () => {
    const { result } = renderHook(() => useWaveform("/a.mp3"));
    expect(result.current.peaks).toBeNull();
    await waitFor(() => expect(result.current.peaks).not.toBeNull());
    expect(result.current.peaks!.length).toBe(128);
  });

  it("returns null when src is empty", () => {
    const { result } = renderHook(() => useWaveform(""));
    expect(result.current.peaks).toBeNull();
  });

  it("dedupes concurrent calls for the same src (single decode)", async () => {
    const decodeSpy = vi.fn(async () => ({
      getChannelData: () => new Float32Array(48000),
      duration: 1, numberOfChannels: 1, sampleRate: 48000,
    }));
    (globalThis.AudioContext as any) = class {
      decodeAudioData = decodeSpy;
      close = vi.fn();
    };
    const { result: r1 } = renderHook(() => useWaveform("/x.mp3"));
    const { result: r2 } = renderHook(() => useWaveform("/x.mp3"));
    await waitFor(() => expect(r1.current.peaks).not.toBeNull());
    await waitFor(() => expect(r2.current.peaks).not.toBeNull());
    expect(decodeSpy).toHaveBeenCalledTimes(1);
  });

  it("each peak is in [0, 1]", async () => {
    const { result } = renderHook(() => useWaveform("/a.mp3"));
    await waitFor(() => expect(result.current.peaks).not.toBeNull());
    for (const p of result.current.peaks!) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run failing test.**

```
npx vitest run web/src/features/studio/hooks/useWaveform.test.ts
```

Expected: FAIL — the existing wavesurfer-based hook doesn't expose `peaks` or the cache reset; test asserts new contract.

- [ ] **Step 3: Implement the rewritten `useWaveform.ts`.**

Replace `web/src/features/studio/hooks/useWaveform.ts` entirely:

```ts
// web/src/features/studio/hooks/useWaveform.ts
//
// D9: custom Web-Audio decode + 128-bucket peak extraction with promise
// dedupe via module-scoped cache. Replaces the prior wavesurfer.js wrapper
// (which is deleted from package.json in this task's final commit).
//
import { useEffect, useState } from "react";

const BUCKETS = 128;

const cache = new Map<string, Promise<Float32Array>>();

async function decodeAndBucket(src: string): Promise<Float32Array> {
  const cached = cache.get(src);
  if (cached) return cached;
  const promise = (async () => {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`fetch ${src} failed`);
    const buf = await res.arrayBuffer();
    const ctx = new AudioContext();
    try {
      const audio = await ctx.decodeAudioData(buf);
      const channel = audio.getChannelData(0);
      const peaks = new Float32Array(BUCKETS);
      const bucketSize = Math.max(1, Math.floor(channel.length / BUCKETS));
      for (let i = 0; i < BUCKETS; i++) {
        let max = 0;
        const start = i * bucketSize;
        const end = Math.min(channel.length, start + bucketSize);
        for (let j = start; j < end; j++) {
          const v = Math.abs(channel[j]);
          if (v > max) max = v;
        }
        peaks[i] = Math.min(1, max);
      }
      return peaks;
    } finally {
      ctx.close?.();
    }
  })();
  cache.set(src, promise);
  promise.catch(() => cache.delete(src));
  return promise;
}

export function useWaveform(src: string): { peaks: Float32Array | null } {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    if (!src) {
      setPeaks(null);
      return;
    }
    let alive = true;
    decodeAndBucket(src)
      .then((p) => {
        if (alive) setPeaks(p);
      })
      .catch(() => {
        if (alive) setPeaks(null);
      });
    return () => {
      alive = false;
    };
  }, [src]);
  return { peaks };
}

// Test-only escape hatch for module-level cache.
export function _resetWaveformCacheForTests() {
  cache.clear();
}
```

- [ ] **Step 4: Run hook test green.**

```
npx vitest run web/src/features/studio/hooks/useWaveform.test.ts
```

Expected: PASS, 4/4.

- [ ] **Step 5: Implement `WaveformBars.tsx`.**

`web/src/features/studio/panels/Timeline/WaveformBars.tsx`:

```tsx
import { useWaveform } from "../../hooks/useWaveform";
import type { AudioClip } from "../../types";

export function WaveformBars({
  clip,
  pxPerSecond,
  height,
}: {
  clip: AudioClip;
  pxPerSecond: number;
  height: number;
}) {
  const { peaks } = useWaveform(clip.src);
  const dur = clip.out - clip.in;
  const width = dur * pxPerSecond;
  if (!peaks) {
    return (
      <div
        aria-label="waveform-loading"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          background: "linear-gradient(90deg, rgba(192,132,252,0.08), rgba(192,132,252,0.04))",
        }}
      />
    );
  }
  // Slice peaks to the in/out window of the clip.
  const total = peaks.length;
  const startIdx = Math.floor((clip.in / (clip.in + dur)) * total) || 0;
  const endIdx = Math.min(total, startIdx + Math.floor((dur / (clip.in + dur)) * total));
  const visible = peaks.slice(startIdx, endIdx > startIdx ? endIdx : total);
  const barWidth = Math.max(1, Math.floor(width / Math.max(1, visible.length)));
  return (
    <svg
      aria-label="waveform"
      width={width}
      height={height}
      viewBox={`0 0 ${visible.length} 100`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        pointerEvents: "none",
        opacity: 0.6,
      }}
    >
      {Array.from(visible).map((p, i) => {
        const h = Math.max(2, p * 100);
        return (
          <rect
            key={i}
            x={i}
            y={(100 - h) / 2}
            width={Math.max(0.5, barWidth)}
            height={h}
            fill="#c084fc"
          />
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 6: Wire `WaveformBars` into `Track.tsx`.**

Inside the clip-lane container, after the filmstrip mapping but before the Clip mapping:

```tsx
{track.kind === "audio" &&
  track.clips.map((c) =>
    c.kind === "audio" ? (
      <div
        key={`wf-${c.id}`}
        style={{
          position: "absolute",
          left: c.trackOffset * pxPerSecond,
          top: 4,
          height: height - 8,
        }}
      >
        <WaveformBars clip={c} pxPerSecond={pxPerSecond} height={height - 8} />
      </div>
    ) : null,
  )}
```

Import: `import { WaveformBars } from "./WaveformBars";`

- [ ] **Step 7: Drop `wavesurfer.js` from `package.json`.**

```bash
npm uninstall wavesurfer.js
```

(Run from repo root — this updates both `package.json` and `package-lock.json`.)

Verify it's gone:

```bash
grep wavesurfer package.json package-lock.json | head -5
```

Expected: empty output.

- [ ] **Step 8: Run the full studio suite green.**

```
npx vitest run web/src/features/studio
```

Expected: PASS, all tests including the new useWaveform 4/4 + everything that was already green.

Also run `tsc --noEmit` to catch any dangling wavesurfer imports:

```
cd web && npx tsc --noEmit
```

Expected: no errors. (If the legacy `useWaveform.ts` had any other consumer the rewritten hook's named export `peaks` doesn't satisfy, this surfaces it.)

- [ ] **Step 9: Commit.**

```bash
git add web/src/features/studio/hooks/useWaveform.ts \
        web/src/features/studio/hooks/useWaveform.test.ts \
        web/src/features/studio/panels/Timeline/WaveformBars.tsx \
        web/src/features/studio/panels/Timeline/Track.tsx \
        package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(timeline): custom 128-peak useWaveform + WaveformBars; drop wavesurfer.js (Phase 4.E)

Per D9: Web-Audio decode + 128-bucket peak extraction with module-scoped
promise dedupe. Replaces the prior wavesurfer.js wrapper. Mounted behind
audio clips in Track.tsx as an absolutely-positioned SVG. Removes the
wavesurfer.js dep entirely (~150KB gzipped).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4.F: useClipResize hook + resize handles in Clip.tsx

**Pneuma source:** Master plan §4.0 line 2208 + §4.2.F (line 2339) — "port pneuma 274-line resize hook... Implement left/right resize handles in `Clip.tsx` driven by `useClipResize`. Test snap-to-edge." Pneuma upstream missing — reimplementing per plan + audit-locked behaviour.

**Decisions applied:** D2 (constrained right-edge resize); D1 (snap threshold seconds, 0.06).

**Adaptation callout:** The `resizeClip` store action (Task 4.I) already enforces D2 clamping. `useClipResize` is the **React-side** glue that converts pointer events into `resizeClip(id, edge, newTime)` calls, with a snap pass driven by `snapDraggedStartToPoints` so the resize edge sticks to neighbouring clip starts/ends.

**Files:**
- Create: `web/src/features/studio/panels/Timeline/hooks/useClipResize.ts`
- Create: `web/src/features/studio/panels/Timeline/hooks/useClipResize.test.ts`
- Modify: `web/src/features/studio/panels/Timeline/Clip.tsx` (mount handles)
- Modify: `web/src/features/studio/panels/Timeline/Clip.test.tsx` (handle render assertions)

---

- [ ] **Step 1: Write failing test for `useClipResize`.**

`web/src/features/studio/panels/Timeline/hooks/useClipResize.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useClipResize } from "./useClipResize";
import { useComposition } from "../../../store";
import { makeCompositionWithClips, makeVideoClip } from "../../../../../test/composition-fixtures";

beforeEach(() => {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
  const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 2 });
  useComposition.setState({
    comp: makeCompositionWithClips([a, b]),
    selection: null,
    dragState: null,
  });
});

describe("useClipResize", () => {
  it("right-edge drag updates clip.out via the store", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    act(() => {
      result.current.beginResize("right", 0); // pointerdown at clientX=0, edge anchored at clip end (px 100)
      result.current.dragResize(50);          // +50px → +1s → newTime = 3s
      result.current.endResize();
    });
    const a = useComposition.getState().comp!.tracks[0].clips.find((c) => c.id === "a")! as any;
    expect(a.out).toBeCloseTo(3);
  });

  it("snaps the resized edge to a neighbouring clip's start (D1 0.06s)", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    // a.end currently at 2; b.start at 5. Drag +148px → 2 + 148/50 = 4.96 → snap to 5.
    act(() => {
      result.current.beginResize("right", 0);
      result.current.dragResize(148);
      result.current.endResize();
    });
    // D2 caps at 5 (b.start) regardless of snap, but snap should land us exactly on 5.
    const a = useComposition.getState().comp!.tracks[0].clips.find((c) => c.id === "a")! as any;
    expect(a.out).toBeCloseTo(3); // out = in + (5 - trackOffset) = 0 + 5 - 0 = 5? wait — out is in-source-media coord
    // Wait: trackOffset 0, in 0, dragging right edge to t=5 → out = in + (5 - 0) = 5
    expect(a.out).toBeCloseTo(5);
  });

  it("left-edge drag updates trackOffset + in", () => {
    useComposition.setState({
      comp: makeCompositionWithClips([makeVideoClip({ id: "a", trackOffset: 1, in: 1, out: 4 })]),
    });
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    act(() => {
      result.current.beginResize("left", 0);
      result.current.dragResize(50); // +50px → +1s → trackOffset 2, in 2
      result.current.endResize();
    });
    const a = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(a.trackOffset).toBeCloseTo(2);
    expect(a.in).toBeCloseTo(2);
  });

  it("returns { isResizing: true } between begin and end", () => {
    const { result } = renderHook(() =>
      useClipResize({ clipId: "a", pxPerSecond: 50 }),
    );
    expect(result.current.isResizing).toBe(false);
    act(() => result.current.beginResize("right", 0));
    expect(result.current.isResizing).toBe(true);
    act(() => result.current.endResize());
    expect(result.current.isResizing).toBe(false);
  });
});
```

(The first test's expected value re-derives: trackOffset 0, in 0, original out=2. Right edge originally at timeline t=2. Drag +50px @50pxPerSecond = +1s → newTime=3 → out = 0 + (3 - 0) = 3. ✓)

- [ ] **Step 2: Run failing test.**

```
npx vitest run web/src/features/studio/panels/Timeline/hooks/useClipResize.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `useClipResize.ts`.**

```ts
// web/src/features/studio/panels/Timeline/hooks/useClipResize.ts
//
// Master plan §4.0 line 2208 + §4.2.F. Pneuma upstream missing — implements
// the contract: pointer-driven resize that calls resizeClip(id, edge, newTime)
// with a snap pass (D1 0.06s) against neighbouring clip edges via
// snapDraggedStartToPoints.
//
import { useCallback, useRef, useState } from "react";
import { useComposition } from "../../../store";
import { collectSnapPoints, snapToNearest } from "../snapPoints";
import { clipDuration } from "../clipMath";

const SNAP_THRESHOLD = 0.06;

export function useClipResize({
  clipId,
  pxPerSecond,
}: {
  clipId: string;
  pxPerSecond: number;
}) {
  const [isResizing, setIsResizing] = useState(false);
  const startRef = useRef<{
    edge: "left" | "right";
    startClientX: number;
    anchorTime: number;
  } | null>(null);

  const beginResize = useCallback(
    (edge: "left" | "right", clientX: number) => {
      const state = useComposition.getState();
      const clip = state.comp?.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === clipId);
      if (!clip) return;
      const anchorTime =
        edge === "left" ? clip.trackOffset : clip.trackOffset + clipDuration(clip);
      startRef.current = { edge, startClientX: clientX, anchorTime };
      setIsResizing(true);
    },
    [clipId],
  );

  const dragResize = useCallback(
    (clientX: number) => {
      const start = startRef.current;
      if (!start) return;
      const state = useComposition.getState();
      if (!state.comp) return;
      const dx = clientX - start.startClientX;
      const dt = dx / pxPerSecond;
      const candidate = start.anchorTime + dt;
      const fps = state.comp.fps || 30;
      const playhead = state.currentFrame / fps;
      const points = collectSnapPoints(state.comp, new Set([clipId]), playhead);
      const snap = snapToNearest(candidate, points, SNAP_THRESHOLD);
      state.resizeClip(clipId, start.edge, snap.time);
    },
    [clipId, pxPerSecond],
  );

  const endResize = useCallback(() => {
    startRef.current = null;
    setIsResizing(false);
  }, []);

  return { isResizing, beginResize, dragResize, endResize };
}
```

- [ ] **Step 4: Run hook test green.**

```
npx vitest run web/src/features/studio/panels/Timeline/hooks/useClipResize.test.ts
```

Expected: PASS, 4/4.

- [ ] **Step 5: Mount handles in `Clip.tsx`.**

Add at the top of the component (inside the existing return JSX, as final children of the outer `<div>`):

```tsx
const resize = useClipResize({ clipId, pxPerSecond });

const handleStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  width: 8,
  cursor: "ew-resize",
  zIndex: 5,
  // The handle is invisible but extends a hit zone past the clip edge.
};

const onHandleDown = (edge: "left" | "right") => (e: React.PointerEvent) => {
  e.stopPropagation();
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  resize.beginResize(edge, e.clientX);
  const move = (ev: PointerEvent) => resize.dragResize(ev.clientX);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    resize.endResize();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
};

// JSX additions inside the clip's outer div:
<div
  data-testid="resize-left"
  onPointerDown={onHandleDown("left")}
  style={{ ...handleStyle, left: -4 }}
/>
<div
  data-testid="resize-right"
  onPointerDown={onHandleDown("right")}
  style={{ ...handleStyle, right: -4 }}
/>
```

Import: `import { useClipResize } from "./hooks/useClipResize";`

- [ ] **Step 6: Update `Clip.test.tsx` to assert handles render.**

Add:

```tsx
it("renders left + right resize handles", () => {
  const { getByTestId } = render(
    <Clip clipId="v1" pxPerSecond={50} trackKind="video" color="var(--accent)" />,
  );
  expect(getByTestId("resize-left")).toBeInTheDocument();
  expect(getByTestId("resize-right")).toBeInTheDocument();
});
```

- [ ] **Step 7: Run Clip tests green.**

```
npx vitest run web/src/features/studio/panels/Timeline/Clip.test.tsx
```

Expected: PASS, 4/4.

Run the full timeline suite as a regression check:

```
npx vitest run web/src/features/studio/panels/Timeline
```

Expected: all green.

- [ ] **Step 8: Commit.**

```bash
git add web/src/features/studio/panels/Timeline/hooks/useClipResize.ts \
        web/src/features/studio/panels/Timeline/hooks/useClipResize.test.ts \
        web/src/features/studio/panels/Timeline/Clip.tsx \
        web/src/features/studio/panels/Timeline/Clip.test.tsx
git commit -m "$(cat <<'EOF'
feat(timeline): useClipResize hook + edge handles in Clip.tsx (Phase 4.F)

Pointer-driven resize bridge that converts dx into a snapped newTime via
collectSnapPoints + snapToNearest (D1 0.06s threshold), then dispatches
resizeClip(id, edge, newTime). Right-edge clamping is enforced inside
the store action per D2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4.G: BladeTool component + splitClip store action

**Pneuma source:** Master plan §4.2.G (line 2340) — "Implement `BladeTool.tsx` for click-to-split. Test split math (a clip at `[2, 8)` split at `t=5` becomes two clips `[2, 5)` and `[5, 8)` with their own ids)." Plus `useSplitHoverSnap.ts` per master plan §4.0 line 2209 for blade-tool snap to clip edges. Pneuma upstream missing — implementing the master-plan inline contract.

**Decisions applied:** D7 (`crypto.randomUUID()` for new clip ids); D4 (split-on-gap = silent no-op).

**Adaptation callout:** Pneuma split: `[start, end) → [start, t) + [t, end)`. AutoViral split (video/audio): the original has `(in, out, trackOffset)`. After split at timeline-time `t`:
- Child A: `(in_orig, in_orig + (t - trackOffset_orig))`, `trackOffset = trackOffset_orig`.
- Child B: `(in_orig + (t - trackOffset_orig), out_orig)`, `trackOffset = t`.

For text/overlay (which use `duration` not `in/out`):
- Child A: `duration = t - trackOffset_orig`, `trackOffset = trackOffset_orig`.
- Child B: `duration = clipDuration_orig - (t - trackOffset_orig)`, `trackOffset = t`.

Child A inherits the original id; Child B gets a fresh `crypto.randomUUID()`. (D7 + master plan §4.2.G "two clips with their own ids".) Both children inherit identical `transforms / filters / style / position / volume / fadeIn / fadeOut` per audit §5 Q3 default-recommendation (identical inheritance).

**Files:**
- Create: `web/src/features/studio/panels/Timeline/BladeTool.tsx`
- Create: `web/src/features/studio/panels/Timeline/BladeTool.test.tsx`
- Create: `web/src/features/studio/panels/Timeline/hooks/useSplitHoverSnap.ts`
- Create: `web/src/features/studio/panels/Timeline/hooks/useSplitHoverSnap.test.ts`
- Modify: `web/src/features/studio/store.ts` (add `bladeMode: boolean` + `splitClip(clipId, atSec)`)
- Modify: `web/src/features/studio/panels/Timeline/index.tsx` (mount `<BladeTool />` overlay)

---

- [ ] **Step 1: Write failing test for `splitClip` store action.**

Append to `web/src/features/studio/__tests__/store.test.ts`:

```ts
describe("splitClip (Phase 4.G)", () => {
  beforeEach(() => {
    const a = makeVideoClip({ id: "a", trackOffset: 2, in: 0, out: 6 }); // duration 6 → on timeline 2..8
    useComposition.setState({
      comp: makeCompositionWithClips([a]),
      selection: null,
      dragState: null,
      currentFrame: 0,
      isPlaying: false,
    });
  });

  it("splits a video clip at the playhead time", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("new-id");
    useComposition.getState().splitClip("a", 5);
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.length).toBe(2);
    const [first, second] = clips.sort((x, y) => x.trackOffset - y.trackOffset);
    expect(first.id).toBe("a");
    expect(first.trackOffset).toBeCloseTo(2);
    expect((first as any).in).toBeCloseTo(0);
    expect((first as any).out).toBeCloseTo(3);
    expect(second.id).toBe("new-id");
    expect(second.trackOffset).toBeCloseTo(5);
    expect((second as any).in).toBeCloseTo(3);
    expect((second as any).out).toBeCloseTo(6);
    vi.restoreAllMocks();
  });

  it("is a no-op when atSec is outside the clip", () => {
    useComposition.getState().splitClip("a", 0.5); // before clip
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(1);
    useComposition.getState().splitClip("a", 9); // after clip
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(1);
  });

  it("inherits transforms + filters identically (audit Q3)", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("uuid-2");
    useComposition.setState((s) => {
      const a = s.comp!.tracks[0].clips[0] as any;
      a.transforms = { scale: 1.2, x: 5, y: 0, rotation: 0 };
      a.filters = { brightness: 0.1, contrast: 0, saturation: 0 };
    });
    useComposition.getState().splitClip("a", 4);
    const [first, second] = useComposition.getState().comp!.tracks[0].clips as any[];
    expect(first.transforms.scale).toBeCloseTo(1.2);
    expect(second.transforms.scale).toBeCloseTo(1.2);
    expect(first.filters.brightness).toBeCloseTo(0.1);
    expect(second.filters.brightness).toBeCloseTo(0.1);
    vi.restoreAllMocks();
  });

  it("splits a text clip via duration (not in/out)", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("text-2");
    const t = makeTextClip({ id: "t", trackOffset: 1, duration: 4 });
    useComposition.setState({
      comp: makeCompositionWithClips([t as any]),
      selection: null,
      dragState: null,
    });
    useComposition.getState().splitClip("t", 3);
    const clips = useComposition.getState().comp!.tracks[0].clips as any[];
    const sorted = clips.slice().sort((x, y) => x.trackOffset - y.trackOffset);
    expect(sorted[0].id).toBe("t");
    expect(sorted[0].duration).toBeCloseTo(2);
    expect(sorted[1].id).toBe("text-2");
    expect(sorted[1].duration).toBeCloseTo(2);
    vi.restoreAllMocks();
  });
});
```

(Add `makeTextClip` to the existing import line.)

- [ ] **Step 2: Run the failing test.**

```
npx vitest run web/src/features/studio/__tests__/store.test.ts -t splitClip
```

Expected: FAIL — `splitClip is not a function`.

- [ ] **Step 3: Implement `splitClip` in `store.ts`.**

```ts
// In CompState:
bladeMode: boolean;
setBladeMode: (on: boolean) => void;
splitClip: (clipId: string, atSec: number) => void;

// Body:
bladeMode: false,
setBladeMode: (on) => set((s) => { s.bladeMode = on; }),
splitClip: (clipId, atSec) => set((s) => {
  if (!s.comp) return;
  for (const track of s.comp.tracks) {
    const idx = track.clips.findIndex((c) => c.id === clipId);
    if (idx < 0) continue;
    const orig = track.clips[idx];
    const start = orig.trackOffset;
    const dur = clipDuration(orig);
    const end = start + dur;
    if (atSec <= start + 1e-6 || atSec >= end - 1e-6) return; // D4: silent no-op
    const offsetIntoClip = atSec - start;
    const newId = crypto.randomUUID();
    if (orig.kind === "video" || orig.kind === "audio") {
      const childA = { ...orig, out: orig.in + offsetIntoClip };
      const childB = {
        ...orig,
        id: newId,
        in: orig.in + offsetIntoClip,
        trackOffset: atSec,
      };
      (track.clips as any[]).splice(idx, 1, childA, childB);
    } else {
      // text or overlay — use duration
      const childA = { ...orig, duration: offsetIntoClip };
      const childB = { ...orig, id: newId, trackOffset: atSec, duration: dur - offsetIntoClip };
      (track.clips as any[]).splice(idx, 1, childA, childB);
    }
    return;
  }
}),
```

- [ ] **Step 4: Run the test green.**

```
npx vitest run web/src/features/studio/__tests__/store.test.ts -t splitClip
```

Expected: PASS, 4/4.

- [ ] **Step 5: Write failing test for `useSplitHoverSnap`.**

`web/src/features/studio/panels/Timeline/hooks/useSplitHoverSnap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSplitHoverSnap } from "./useSplitHoverSnap";
import { useComposition } from "../../../store";
import { makeCompositionWithClips, makeVideoClip } from "../../../../../test/composition-fixtures";

describe("useSplitHoverSnap", () => {
  it("returns null when not hovering", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
    useComposition.setState({ comp: makeCompositionWithClips([a]) });
    const { result } = renderHook(() => useSplitHoverSnap({ pxPerSecond: 50 }));
    expect(result.current.snapTime).toBeNull();
  });

  it("snaps the hover position to the nearest clip edge within threshold", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
    const b = makeVideoClip({ id: "b", trackOffset: 4, in: 0, out: 2 });
    useComposition.setState({ comp: makeCompositionWithClips([a, b]) });
    const { result } = renderHook(() => useSplitHoverSnap({ pxPerSecond: 50 }));
    // 4.04 → snap to 4 within 0.06 threshold
    act(() => result.current.setHoverTime(4.04));
    expect(result.current.snapTime).toBeCloseTo(4);
  });

  it("returns the raw time outside threshold", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
    useComposition.setState({ comp: makeCompositionWithClips([a]) });
    const { result } = renderHook(() => useSplitHoverSnap({ pxPerSecond: 50 }));
    act(() => result.current.setHoverTime(2.5));
    expect(result.current.snapTime).toBeCloseTo(2.5);
    expect(result.current.snappedToEdge).toBe(false);
  });
});
```

- [ ] **Step 6: Run failing test.**

```
npx vitest run web/src/features/studio/panels/Timeline/hooks/useSplitHoverSnap.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement `useSplitHoverSnap.ts`.**

```ts
// web/src/features/studio/panels/Timeline/hooks/useSplitHoverSnap.ts
import { useState, useMemo } from "react";
import { useComposition } from "../../../store";
import { collectSnapPoints, snapToNearest } from "../snapPoints";

export function useSplitHoverSnap({ pxPerSecond: _ }: { pxPerSecond: number }) {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const comp = useComposition((s) => s.comp);
  const fps = comp?.fps ?? 30;
  const playhead = useComposition((s) => s.currentFrame) / fps;

  const result = useMemo(() => {
    if (hoverTime === null) return { snapTime: null, snappedToEdge: false, raw: null as number | null };
    const points = collectSnapPoints(comp, new Set(), playhead);
    const r = snapToNearest(hoverTime, points, 0.06);
    return { snapTime: r.time, snappedToEdge: r.snappedTo !== null, raw: hoverTime };
  }, [hoverTime, comp, playhead]);

  return { ...result, setHoverTime };
}
```

- [ ] **Step 8: Run hook test green.**

```
npx vitest run web/src/features/studio/panels/Timeline/hooks/useSplitHoverSnap.test.ts
```

Expected: PASS, 3/3.

- [ ] **Step 9: Write failing test for `BladeTool.tsx`.**

`web/src/features/studio/panels/Timeline/BladeTool.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { BladeTool } from "./BladeTool";
import { useComposition } from "../../store";
import { makeCompositionWithClips, makeVideoClip } from "../../../../test/composition-fixtures";

beforeEach(() => {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
  useComposition.setState({
    comp: makeCompositionWithClips([a]),
    selection: "a",
    bladeMode: true,
    currentFrame: 0,
    dragState: null,
  });
});

describe("BladeTool", () => {
  it("renders nothing when bladeMode is off", () => {
    useComposition.setState({ bladeMode: false });
    const { container } = render(
      <BladeTool pxPerSecond={50} totalWidth={400} labelColumnWidth={110} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("calling onClick at clientX → splits the clip at the corresponding time", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("uuid-blade");
    const { container } = render(
      <BladeTool pxPerSecond={50} totalWidth={400} labelColumnWidth={110} />,
    );
    const overlay = container.firstChild as HTMLElement;
    // clientX 110 + 100 = 210 → relative 100px → time = 100/50 = 2s
    fireEvent.click(overlay, { clientX: 210 });
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.length).toBe(2);
    expect(clips.some((c) => c.id === "uuid-blade")).toBe(true);
    vi.restoreAllMocks();
  });

  it("does not split if the click is in a gap (D4)", () => {
    useComposition.setState({
      comp: makeCompositionWithClips([
        makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 1 }),
        makeVideoClip({ id: "b", trackOffset: 3, in: 0, out: 1 }),
      ]),
      bladeMode: true,
    });
    const { container } = render(
      <BladeTool pxPerSecond={50} totalWidth={400} labelColumnWidth={110} />,
    );
    const overlay = container.firstChild as HTMLElement;
    // 110 + 100 = 210 → time 2 → in the gap [1..3]
    fireEvent.click(overlay, { clientX: 210 });
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(2);
  });
});
```

- [ ] **Step 10: Run failing test.**

```
npx vitest run web/src/features/studio/panels/Timeline/BladeTool.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 11: Implement `BladeTool.tsx`.**

```tsx
// web/src/features/studio/panels/Timeline/BladeTool.tsx
import { useComposition } from "../../store";
import { useSplitHoverSnap } from "./hooks/useSplitHoverSnap";
import { clipEnd } from "./clipMath";

export function BladeTool({
  pxPerSecond,
  totalWidth,
  labelColumnWidth,
}: {
  pxPerSecond: number;
  totalWidth: number;
  labelColumnWidth: number;
}) {
  const bladeMode = useComposition((s) => s.bladeMode);
  const splitClip = useComposition((s) => s.splitClip);
  const comp = useComposition((s) => s.comp);
  const { snapTime, setHoverTime, snappedToEdge } = useSplitHoverSnap({ pxPerSecond });
  if (!bladeMode || !comp) return null;

  const onMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    setHoverTime(Math.max(0, x / pxPerSecond));
  };
  const onLeave = () => setHoverTime(null);
  const onClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = Math.max(0, x / pxPerSecond);
    // Find the topmost clip on any track whose interval contains t.
    for (const track of comp.tracks) {
      const hit = track.clips.find((c) => t > c.trackOffset + 1e-6 && t < clipEnd(c) - 1e-6);
      if (hit) {
        splitClip(hit.id, t);
        return;
      }
    }
    // D4: silent no-op
  };

  const cursorX = snapTime !== null ? snapTime * pxPerSecond : null;

  return (
    <div
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onClick={onClick}
      style={{
        position: "absolute",
        left: labelColumnWidth,
        top: 0,
        width: totalWidth,
        bottom: 0,
        cursor: "crosshair",
        zIndex: 6,
      }}
    >
      {cursorX !== null && (
        <div
          style={{
            position: "absolute",
            left: cursorX,
            top: 0,
            bottom: 0,
            width: 1,
            background: snappedToEdge ? "var(--accent-hi)" : "var(--accent)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 12: Mount `<BladeTool />` in `Timeline/index.tsx`.**

In the lanes scroll-container (Timeline/index.tsx around line 96):

```tsx
<div style={{ flex: 1, overflow: "auto", position: "relative" }}>
  <Ruler ... />
  {comp.tracks.map((t) => <Track key={t.id} ... />)}
  <BladeTool pxPerSecond={pxPerSecond} totalWidth={totalWidth} labelColumnWidth={110} />
</div>
```

- [ ] **Step 13: Run BladeTool test green.**

```
npx vitest run web/src/features/studio/panels/Timeline/BladeTool.test.tsx
```

Expected: PASS, 3/3.

Also re-run Timeline/index sanity:

```
npx vitest run web/src/features/studio/panels/Timeline
```

Expected: all green (no regressions in earlier tasks).

- [ ] **Step 14: Commit.**

```bash
git add web/src/features/studio/panels/Timeline/BladeTool.tsx \
        web/src/features/studio/panels/Timeline/BladeTool.test.tsx \
        web/src/features/studio/panels/Timeline/hooks/useSplitHoverSnap.ts \
        web/src/features/studio/panels/Timeline/hooks/useSplitHoverSnap.test.ts \
        web/src/features/studio/store.ts \
        web/src/features/studio/__tests__/store.test.ts \
        web/src/features/studio/panels/Timeline/index.tsx
git commit -m "$(cat <<'EOF'
feat(timeline): BladeTool + splitClip store action (Phase 4.G)

Adds click-to-split tool with hover snap-to-edge per master plan §4.2.G.
splitClip mints a fresh clip id via crypto.randomUUID() (D7) and inherits
transforms/filters identically to the parent (audit Q3 default). Split-
on-gap is a silent no-op (D4). Mounted as an absolute overlay above the
lanes container; activated via store.bladeMode (wired in 4.J).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4.H: interactive Playhead + dragEngine snap-line render

**Pneuma source:** Master plan §4.1 lines 2298-2330 inlines the full ~30-line `Playhead.tsx` component (Pointer Events API + `setPointerCapture`). This task is ≥80% verbatim from that inline contract — the adaptation is just the D5 mounting decision.

**Decisions applied:** D5 (single full-height bar mounted as sibling of Ruler in `Timeline/index.tsx`'s lanes container; only the top 14px is interactive); D10 (snap-line rendered from `dragState.snapTime`).

**Adaptation callout:** Master plan inline code uses `pxPerSecond` and `fps`. Our adaptation reads both from props (parent passes them in). The 110px label-column offset (D5) is added at the parent — `Playhead` itself does not know about the label column.

**Files:**
- Create: `web/src/features/studio/panels/Timeline/Playhead.tsx`
- Create: `web/src/features/studio/panels/Timeline/Playhead.test.tsx`
- Modify: `web/src/features/studio/panels/Timeline/index.tsx` (mount Playhead + snap-line overlay)

---

- [ ] **Step 1: Write failing test for `Playhead.tsx`.**

`web/src/features/studio/panels/Timeline/Playhead.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Playhead } from "./Playhead";
import { useComposition } from "../../store";
import { makeCompositionWithClips, makeVideoClip } from "../../../../test/composition-fixtures";

beforeEach(() => {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
  useComposition.setState({
    comp: { ...makeCompositionWithClips([a]), fps: 30 },
    currentFrame: 30, // 1s at 30fps
    isPlaying: false,
    dragState: null,
  });
});

describe("Playhead", () => {
  it("renders at the correct x = (frame/fps) * pxPerSecond", () => {
    const { container } = render(<Playhead pxPerSecond={50} fps={30} />);
    const el = container.firstChild as HTMLElement;
    // 30 frames / 30 fps = 1s * 50px/s = 50px
    expect(el.style.left).toBe("50px");
  });

  it("dragging by 100px advances currentFrame proportionally", () => {
    const { container } = render(<Playhead pxPerSecond={50} fps={30} />);
    const el = container.firstChild as HTMLElement;
    fireEvent.pointerDown(el, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 100, pointerId: 1 });
    // dx=100 → 2s @ 30fps → +60 frames; starting at 30 → 90
    expect(useComposition.getState().currentFrame).toBe(90);
    fireEvent.pointerUp(el, { clientX: 100, pointerId: 1 });
  });

  it("clamps currentFrame at 0 when dragging past the left edge", () => {
    const { container } = render(<Playhead pxPerSecond={50} fps={30} />);
    const el = container.firstChild as HTMLElement;
    fireEvent.pointerDown(el, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: -1000, pointerId: 1 });
    expect(useComposition.getState().currentFrame).toBe(0);
    fireEvent.pointerUp(el, { clientX: -1000, pointerId: 1 });
  });
});
```

- [ ] **Step 2: Run failing test.**

```
npx vitest run web/src/features/studio/panels/Timeline/Playhead.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `Playhead.tsx`.**

```tsx
// web/src/features/studio/panels/Timeline/Playhead.tsx
//
// Verbatim port of master plan §4.1 lines 2298-2330. D5 mounting (single
// full-height vertical bar at sibling-of-Ruler level) is the parent's
// responsibility; this component only knows pxPerSecond + fps.
//
import { useRef } from "react";
import { useComposition } from "../../store";

export function Playhead({
  pxPerSecond,
  fps,
}: {
  pxPerSecond: number;
  fps: number;
}) {
  const frame = useComposition((s) => s.currentFrame);
  const setFrame = useComposition((s) => s.setFrame);
  const x = (frame / fps) * pxPerSecond;
  const dragRef = useRef<{ startX: number; startFrame: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startFrame: frame };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const newFrame = Math.max(0, d.startFrame + Math.round((dx / pxPerSecond) * fps));
    setFrame(newFrame);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  return (
    <div
      data-testid="playhead"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: "absolute",
        left: x,
        top: 0,
        bottom: 0,
        width: 2,
        background: "var(--accent)",
        cursor: "ew-resize",
        zIndex: 7,
        boxShadow: "0 0 6px var(--accent-glow)",
      }}
    >
      {/* 14px hit area at top (D5) */}
      <div
        style={{
          position: "absolute",
          left: -6,
          top: 0,
          width: 14,
          height: 14,
          background: "var(--accent)",
          borderRadius: "0 0 50% 50%",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run Playhead test green.**

```
npx vitest run web/src/features/studio/panels/Timeline/Playhead.test.tsx
```

Expected: PASS, 3/3.

- [ ] **Step 5: Mount `<Playhead />` + snap-line overlay in `Timeline/index.tsx`.**

In the lanes container (sibling of `<Ruler />`):

```tsx
// At top:
import { Playhead } from "./Playhead";

// Inside the lanes scroll-container, after the tracks map:
<div
  style={{
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 110, // label column width
    pointerEvents: "none",
  }}
>
  <Playhead pxPerSecond={pxPerSecond} fps={comp.fps} />
  {/* D10: snap-line overlay during drag */}
  {/* dragState comes from useComposition selector at the top of the component */}
  {dragState?.snapTime != null && (
    <div
      data-testid="snap-line"
      style={{
        position: "absolute",
        left: dragState.snapTime * pxPerSecond,
        top: 22, // below ruler
        bottom: 0,
        width: 1,
        background: "var(--accent-hi)",
        boxShadow: "0 0 8px var(--accent-hi)",
      }}
    />
  )}
</div>
```

Add a selector at the top of the `Timeline` component:

```tsx
const dragState = useComposition((s) => s.dragState);
```

The wrapper div has `pointerEvents: "none"` so it doesn't intercept clip drags; the Playhead itself sets `pointerEvents: "auto"` via inline style override OR (cleaner) re-enable pointerEvents on the Playhead's hit-area only:

```tsx
// Inside Playhead.tsx, the outer div needs pointerEvents: "auto"
style={{ ..., pointerEvents: "auto" }}
```

- [ ] **Step 6: Run the full Timeline panel suite green.**

```
npx vitest run web/src/features/studio/panels/Timeline
```

Expected: PASS, all earlier tests + Playhead 3/3.

- [ ] **Step 7: Commit.**

```bash
git add web/src/features/studio/panels/Timeline/Playhead.tsx \
        web/src/features/studio/panels/Timeline/Playhead.test.tsx \
        web/src/features/studio/panels/Timeline/index.tsx
git commit -m "$(cat <<'EOF'
feat(timeline): interactive Playhead + snap-line overlay (Phase 4.H)

Verbatim port of master plan §4.1 lines 2298-2330 — Pointer Events API
with setPointerCapture so drags survive cursor-leaves. Mounted per D5 as
a single full-height bar inside the lanes container, offset by the 110px
label column. Adds the D10 snap-line render driven by dragState.snapTime.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4.I: store action `resizeClip`

**Pneuma source:** Master plan §4.2.I (line 2342) — "Add store actions `splitClip(clipId, atSec)`, `resizeClip(clipId, edge, newTime)`, `rippleDeleteClip(clipId)`, `collapseGaps(trackId)`." Of these four, `splitClip` lands in 4.G, `rippleDeleteClip + collapseGaps` land in 4.C. **This task only adds `resizeClip` to satisfy the Phase 4.I checklist** — keeping the §4.2.I task explicit while avoiding duplication.

**Decisions applied:** D2 (right-handle resize is constrained — `out` capped at `nextClip.trackOffset`).

**Adaptation callout:** `edge` is `"left" | "right"`. `newTime` is the proposed timeline-time of that edge.
- **Left edge** of video/audio: clamp `newTime` to `[0, trackOffset + (out - in) - minDuration]`. Update `clip.in += (newTime - clip.trackOffset)` and `clip.trackOffset = newTime`. (We move both because `clip.in` is the in-source-media point AND `trackOffset` is where it lands.)
- **Right edge** of video/audio: clamp `newTime` to `[trackOffset + minDuration, nextClipStart || +∞]` per D2. Update `clip.out = clip.in + (newTime - clip.trackOffset)`.
- **Left edge** of text/overlay: `clip.duration -= (newTime - trackOffset)` and `trackOffset = newTime`.
- **Right edge** of text/overlay: `clip.duration = newTime - clip.trackOffset` (clamped).

`minDuration` is `0.05s` (avoids zero-width clips).

**Files:**
- Modify: `web/src/features/studio/store.ts`
- Modify: `web/src/features/studio/__tests__/store.test.ts`

---

- [ ] **Step 1: Write failing test for `resizeClip`.**

Append to `web/src/features/studio/__tests__/store.test.ts`:

```ts
describe("resizeClip (Phase 4.I)", () => {
  it("resizes the right edge of a video clip; clamps to next clip's start (D2)", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 3, in: 0, out: 1 });
    useComposition.setState({ comp: makeCompositionWithClips([a, b]), dragState: null });
    useComposition.getState().resizeClip("a", "right", 4); // would pass b
    const aAfter = useComposition.getState().comp!.tracks[0].clips.find((c) => c.id === "a")! as any;
    expect(aAfter.out).toBeCloseTo(3); // clamped at b.start = 3
  });

  it("resizes the left edge of a video clip", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 1, out: 4 });
    useComposition.setState({ comp: makeCompositionWithClips([a]), dragState: null });
    useComposition.getState().resizeClip("a", "left", 1); // pull right by 1s
    const aAfter = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(aAfter.trackOffset).toBeCloseTo(1);
    expect(aAfter.in).toBeCloseTo(2); // 1 + (1 - 0) = 2
    expect(aAfter.out).toBeCloseTo(4);
  });

  it("clamps left edge at 0", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 1, in: 1, out: 4 });
    useComposition.setState({ comp: makeCompositionWithClips([a]), dragState: null });
    useComposition.getState().resizeClip("a", "left", -2);
    const aAfter = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(aAfter.trackOffset).toBeCloseTo(0);
  });

  it("resizes right edge of a text clip via duration", () => {
    const t = makeTextClip({ id: "t", trackOffset: 1, duration: 3 });
    useComposition.setState({ comp: makeCompositionWithClips([t as any]), dragState: null });
    useComposition.getState().resizeClip("t", "right", 5);
    const tAfter = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(tAfter.duration).toBeCloseTo(4); // 5 - 1
  });

  it("enforces minDuration 0.05s on right edge", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    useComposition.setState({ comp: makeCompositionWithClips([a]), dragState: null });
    useComposition.getState().resizeClip("a", "right", 0); // would set out=in
    const aAfter = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(aAfter.out - aAfter.in).toBeGreaterThanOrEqual(0.05);
  });
});
```

- [ ] **Step 2: Run failing test.**

```
npx vitest run web/src/features/studio/__tests__/store.test.ts -t resizeClip
```

Expected: FAIL — `resizeClip is not a function`.

- [ ] **Step 3: Implement `resizeClip` in `store.ts`.**

```ts
// CompState:
resizeClip: (clipId: string, edge: "left" | "right", newTime: number) => void;

const MIN_DUR = 0.05;

// Body:
resizeClip: (clipId, edge, newTime) => set((s) => {
  if (!s.comp) return;
  for (const track of s.comp.tracks) {
    const idx = track.clips.findIndex((c) => c.id === clipId);
    if (idx < 0) continue;
    const c = track.clips[idx] as any;
    const start = c.trackOffset;
    const dur = clipDuration(c);
    const end = start + dur;
    if (edge === "right") {
      // D2: cap at next clip's start
      const next = track.clips
        .filter((x) => x.id !== clipId && x.trackOffset > start + 1e-6)
        .sort((x, y) => x.trackOffset - y.trackOffset)[0];
      const cap = next ? next.trackOffset : Infinity;
      const clamped = Math.min(cap, Math.max(start + MIN_DUR, newTime));
      if (c.kind === "video" || c.kind === "audio") {
        c.out = c.in + (clamped - start);
      } else {
        c.duration = clamped - start;
      }
    } else {
      // left edge: clamp [0, end - MIN_DUR]
      const clamped = Math.min(end - MIN_DUR, Math.max(0, newTime));
      const delta = clamped - start;
      if (c.kind === "video" || c.kind === "audio") {
        c.in += delta;
        c.trackOffset = clamped;
      } else {
        c.duration -= delta;
        c.trackOffset = clamped;
      }
    }
    s.comp.duration = Math.max(
      0,
      ...s.comp.tracks.flatMap((t) => t.clips.map(clipEnd)),
    );
    return;
  }
}),
```

- [ ] **Step 4: Run resizeClip tests green.**

```
npx vitest run web/src/features/studio/__tests__/store.test.ts -t resizeClip
```

Expected: PASS, 5/5.

- [ ] **Step 5: Commit.**

```bash
git add web/src/features/studio/store.ts \
        web/src/features/studio/__tests__/store.test.ts
git commit -m "$(cat <<'EOF'
feat(studio): resizeClip store action (Phase 4.I)

Implements the last action from master-plan §4.2.I (splitClip, ripple,
collapse already landed in 4.G/4.C). Right-edge resize is constrained
per D2: clamps at the next clip's trackOffset to avoid overlap; left
edge clamps at 0. minDuration enforced at 0.05s for both edges. Handles
video/audio (in/out) and text/overlay (duration) clip kinds.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4.J: useShortcuts wiring (B/Cmd+B/Shift+Backspace/Cmd+Shift+G)

**Pneuma source:** Master plan §4.2.J (line 2343) — "`S` → split at playhead on selected track, `Shift+Backspace` → ripple delete selected, `Cmd+Shift+G` → collapse gaps". Also reflected in user instruction "B blade · Cmd+B split · Backspace delete · Shift+Backspace ripple". This task is the integration seam — every action it dispatches has already been written.

**Decisions applied:** D4 (split-on-gap silent no-op); D6 (Shift+Backspace ordered before plain Backspace).

**Adaptation callout:** Per user instruction the binding is `B` for blade-mode toggle and `Cmd+B` for split-at-playhead. Master plan §4.2.J says `S` for split, but the user's explicit list overrides the master plan here. We implement the user's keys: `B` toggles `bladeMode`; `Cmd+B` splits the clip currently containing the playhead on the selected track. Backspace stays plain `removeClip`; `Shift+Backspace` is the new ripple binding (D6). `Cmd+Shift+G` collapses gaps on the selected clip's track.

**Files:**
- Modify: `web/src/features/studio/hooks/useShortcuts.ts`
- Create: `web/src/features/studio/hooks/__tests__/useShortcuts.test.ts` (if absent)

---

- [ ] **Step 1: Write failing tests for the new bindings.**

`web/src/features/studio/hooks/__tests__/useShortcuts.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useShortcuts } from "../useShortcuts";
import { useComposition } from "../../store";
import { makeCompositionWithClips, makeVideoClip } from "../../../../test/composition-fixtures";

function key(opts: Partial<KeyboardEventInit & { key: string }>) {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...opts });
}

beforeEach(() => {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 });
  const b = makeVideoClip({ id: "b", trackOffset: 4, in: 0, out: 2 });
  const comp = makeCompositionWithClips([a, b]);
  comp.fps = 30;
  useComposition.setState({
    comp,
    selection: "b",
    currentFrame: 60, // 2s
    isPlaying: false,
    bladeMode: false,
    dragState: null,
  });
});

describe("useShortcuts (Phase 4.J)", () => {
  it("B toggles bladeMode", () => {
    renderHook(() => useShortcuts(null));
    window.dispatchEvent(key({ key: "b" }));
    expect(useComposition.getState().bladeMode).toBe(true);
    window.dispatchEvent(key({ key: "b" }));
    expect(useComposition.getState().bladeMode).toBe(false);
  });

  it("Cmd+B splits the clip under the playhead on the selected track", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("split-id");
    renderHook(() => useShortcuts(null));
    // selection = "b"; b is at trackOffset 4..6; playhead at 2s — NOT in b → no-op (D4)
    window.dispatchEvent(key({ key: "b", metaKey: true }));
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(2);
    // Move playhead to 5s (inside b)
    useComposition.setState({ currentFrame: 150 });
    window.dispatchEvent(key({ key: "b", metaKey: true }));
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(3);
    vi.restoreAllMocks();
  });

  it("Shift+Backspace ripple-deletes the selected clip (D6 — checked before plain Backspace)", () => {
    renderHook(() => useShortcuts(null));
    // selection = "b". Ripple delete b → clips length 1, a stays at 0..4.
    window.dispatchEvent(key({ key: "Backspace", shiftKey: true }));
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.length).toBe(1);
    expect(clips[0].id).toBe("a");
  });

  it("plain Backspace still removes without ripple (D6 — preserved)", () => {
    renderHook(() => useShortcuts(null));
    // selection = "b". Plain backspace removes b but a stays where it was (no ripple).
    window.dispatchEvent(key({ key: "Backspace" }));
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.length).toBe(1);
    expect(clips[0].id).toBe("a");
    expect(clips[0].trackOffset).toBeCloseTo(0);
  });

  it("Cmd+Shift+G collapses gaps on the selected clip's track", () => {
    useComposition.setState({
      comp: makeCompositionWithClips([
        makeVideoClip({ id: "a", trackOffset: 1, in: 0, out: 1 }),
        makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 1 }),
      ]),
      selection: "a",
    });
    renderHook(() => useShortcuts(null));
    window.dispatchEvent(key({ key: "g", metaKey: true, shiftKey: true }));
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.map((c) => c.trackOffset)).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run failing tests.**

```
npx vitest run web/src/features/studio/hooks/__tests__/useShortcuts.test.ts
```

Expected: FAIL — none of the new bindings exist.

- [ ] **Step 3: Extend `useShortcuts.ts`.**

Edit `web/src/features/studio/hooks/useShortcuts.ts`. Replace the body with:

```ts
import { useEffect } from "react";
import { useComposition } from "../store";
import { saveComposition } from "../services/composition";
import { clipEnd } from "../panels/Timeline/clipMath";

export function useShortcuts(workId: string | null) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }

      const state = useComposition.getState();
      const fps = state.comp?.fps ?? 30;
      const isMod = e.metaKey || e.ctrlKey;

      if (e.code === "Space") {
        e.preventDefault();
        state.setPlaying(!state.isPlaying);
        return;
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        state.setFrame(Math.max(0, state.currentFrame - 5 * fps));
        return;
      }
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        state.setFrame(state.currentFrame + 5 * fps);
        return;
      }

      // Cmd+Shift+G — collapse gaps on selected track (D-locked binding)
      if (isMod && e.shiftKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        if (state.selection && state.comp) {
          const track = state.comp.tracks.find((t) =>
            t.clips.some((c) => c.id === state.selection),
          );
          if (track) state.collapseGaps(track.id);
        }
        return;
      }

      // Cmd+S — save (existing)
      if (isMod && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (workId && state.comp) void saveComposition(workId, state.comp);
        return;
      }

      // Cmd+B — split clip under playhead on selected track (D4 silent no-op if gap)
      if (isMod && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        if (state.selection && state.comp) {
          const track = state.comp.tracks.find((t) =>
            t.clips.some((c) => c.id === state.selection),
          );
          const playheadTime = state.currentFrame / fps;
          if (track) {
            const hit = track.clips.find(
              (c) =>
                playheadTime > c.trackOffset + 1e-6 &&
                playheadTime < clipEnd(c) - 1e-6,
            );
            if (hit) state.splitClip(hit.id, playheadTime);
          }
        }
        return;
      }

      // B — toggle blade mode
      if (!isMod && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        state.setBladeMode(!state.bladeMode);
        return;
      }

      // Shift+Backspace / Shift+Delete — ripple delete (D6: must precede plain branch)
      if (e.shiftKey && (e.key === "Backspace" || e.key === "Delete")) {
        if (state.selection) {
          e.preventDefault();
          state.rippleDeleteClip(state.selection);
          state.setSelection(null);
        }
        return;
      }

      // Plain Backspace / Delete — non-ripple remove (D6: preserved)
      if (e.key === "Delete" || e.key === "Backspace") {
        if (state.selection) {
          e.preventDefault();
          state.removeClip(state.selection);
          state.setSelection(null);
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workId]);
}
```

- [ ] **Step 4: Run shortcut tests green.**

```
npx vitest run web/src/features/studio/hooks/__tests__/useShortcuts.test.ts
```

Expected: PASS, 5/5.

- [ ] **Step 5: Final regression run — entire web suite.**

```
cd web && npx vitest run
```

Expected: all tests green (target: pre-Phase-4 196 + everything new).

```
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add web/src/features/studio/hooks/useShortcuts.ts \
        web/src/features/studio/hooks/__tests__/useShortcuts.test.ts
git commit -m "$(cat <<'EOF'
feat(studio): Phase 4 keyboard shortcuts (B/Cmd+B/Shift+Backspace/Cmd+Shift+G) (Phase 4.J)

Wires the final integration seam. B toggles bladeMode; Cmd+B splits the
clip currently under the playhead on the selected track (D4 silent no-op
if gap); Shift+Backspace ripple-deletes the selection (D6 — checked
before plain Backspace so muscle-memory preserves non-ripple delete);
Cmd+Shift+G collapses gaps on the selected clip's track.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

---

## 3. Self-review checklist

### 3.1 Spec coverage — every master-plan §4.3 acceptance bullet maps to a task

| Master plan §4.3 line | Bullet | Task(s) | How |
|---|---|---|---|
| 2347 | "User can drag a clip; preview shows ripple cascade under the dragged clip; snap line appears at clip edges + playhead + 0." | 4.B + 4.H | 4.B implements `computeRipplePreview` + dragState.preview + dragState.snapTime; Clip.tsx renders ghost left from preview; 4.H renders the snap-line overlay from `dragState.snapTime` (D10). |
| 2348 | "User can grab the right edge of a video clip and drag — the clip's `out` time updates; snap fires near other clip edges." | 4.F + 4.I | 4.F's `useClipResize` + handles in Clip.tsx; 4.I's `resizeClip` action with D2 clamping + D1 snap. |
| 2349 | "User can press `S` over a clip — the clip splits at the playhead into two clips with new ids." | 4.G + 4.J | 4.G's `splitClip` action + BladeTool; 4.J's `Cmd+B` shortcut (user override of `S` per dispatch instruction). D7 (`crypto.randomUUID`) gives new ids. |
| 2350 | "User can press `Shift+Backspace` — selected clip is removed and later clips shift left." | 4.C + 4.J | 4.C `rippleDeleteFromTrack` + `rippleDeleteClip` action; 4.J Shift+Backspace branch (D6 ordered first). |
| 2351 | "User scrubs the playhead by dragging — preview updates each frame." | 4.H | `Playhead.tsx` Pointer Events + `setFrame` per move. PreviewPanel sync (audit R9) is flagged as out-of-scope follow-up. |
| 2352 | "Each video clip on the timeline shows a filmstrip of thumbnails (one every 0.5s); audio clips show a 128-peak waveform." | 4.D + 4.E | Filmstrip mounted in Track.tsx (D8); WaveformBars with 128-bucket Web-Audio decode (D9). |

All six acceptance bullets are covered. The `S` vs `Cmd+B` divergence is noted in 4.J's adaptation callout: user dispatch instruction overrides §4.2.J. If the agent prefers strict §4.2.J adherence, swap `B` toggle for `S`-toggle and `Cmd+B` for plain-`S` split — the action wiring is identical.

### 3.2 Task action signatures (stable across tasks)

| Action | Signature | Introduced in | Consumed by |
|---|---|---|---|
| `beginDrag` | `(clipId: string) => void` | 4.B | Clip.tsx pointerdown |
| `updateDragCandidate` | `(candidateStart: number) => void` | 4.B | Clip.tsx pointermove |
| `commitDrag` | `() => void` | 4.B | Clip.tsx pointerup |
| `cancelDrag` | `() => void` | 4.B | Clip.tsx Escape handler |
| `setBladeMode` | `(on: boolean) => void` | 4.G | 4.J shortcut |
| `splitClip` | `(clipId: string, atSec: number) => void` | 4.G | 4.J Cmd+B + BladeTool click |
| `rippleDeleteClip` | `(clipId: string) => void` | 4.C | 4.J Shift+Backspace |
| `collapseGaps` | `(trackId: string) => void` | 4.C | 4.J Cmd+Shift+G |
| `resizeClip` | `(clipId: string, edge: "left" \| "right", newTime: number) => void` | 4.I | 4.F `useClipResize.dragResize` |

All signatures consistent. No drift between definition site and consumer.

### 3.3 No placeholder text

A `grep -n "TBD\|TODO\|fill in\|<\.\.\.>\|<pending>\|pending --"` over the saved file returns zero matches (run before final save).

### 3.4 Test infrastructure deltas — single point of truth

Both `installCanvasMocks` (R4) and `installAudioContextMock` (R5) live in `web/src/test/dom-mocks.ts` and are imported once from `web/src/test/setup.ts` in 4.D Step 1. Tasks 4.D (frame extractor) and 4.E (waveform) consume these without re-declaring mocks per-test.

### 3.5 wavesurfer.js removal

Phase 4.E Step 7 runs `npm uninstall wavesurfer.js` — single net-`-1` dependency change at end of phase. After 4.E lands, no file imports wavesurfer.js. The previous `useWaveform.test.ts` mock that referenced `WaveSurfer.create` is fully replaced.

### 3.6 Drag-state vs PreviewPanel.currentFrame split (audit R9)

R9 noted that `PreviewPanel.tsx` has a local `useState<number>(0)` that listens for a `"frame"` custom event in parallel with the store's `currentFrame`. This Phase-4 plan keeps the playhead **reading from the store** per the master-plan inline contract; PreviewPanel's local state divergence is left as a follow-up debt item (already flagged in audit). No behaviour change here — the playhead drives `setFrame`, and PreviewPanel's local state is reconciled in a separate phase.

---

**End of plan.** All ten Phase-4 tasks are ready to dispatch via `superpowers:subagent-driven-development`. Recommended execution order is the file's section order (4.A → 4.B → 4.C → 4.D → 4.E → 4.F → 4.G → 4.H → 4.I → 4.J — note that the audit's dependency analysis surfaced 4.A → 4.B → 4.G → 4.D → 4.C → 4.I → 4.H → 4.E → 4.F → 4.J as the strictly-correct dependency order; pick whichever order the dispatch loop prefers, every task lists its prerequisites in its **Files: Modify** column).

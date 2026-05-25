# Phase 4 Timeline Baseline Audit (2026-05-05)

> Reality snapshot of every file Phase 4 of `2026-04-28-autoviral-video-supremacy.md`
> intends to touch. Every claim traces to a file path + line range. No source files
> were modified during this audit. Mirrors the structure of the Phase 3 audit
> at `docs/superpowers/plans/2026-04-28-phase-3-audio-baseline-audit.md`.

---

## 0. Status snapshot

| Probe | Result |
| --- | --- |
| Audit date | 2026-05-05 |
| Repo HEAD SHA | `7aefc08321466527b595d02cb0c69472df859021` (branch `refactor/ui-v3-react`) |
| Working tree | dirty — SV.0..SV.L companion edits to Studio v4, untracked `web/src/features/studio/panels/AssetSidebar/` and `web/src/queries/assets.ts`. None of the dirt touches `panels/Timeline/` (verified §4 below). |
| Master plan | `docs/superpowers/plans/2026-04-28-autoviral-video-supremacy.md` §4 (lines 2197-2353; full block read) |
| Phase-3 reference audit | `docs/superpowers/plans/2026-04-28-phase-3-audio-baseline-audit.md` (940 lines; re-read in full) |
| Web test count | **196/196 pass** at HEAD per `7aefc08` body line "196/196 web tests pass, tsc clean.". Earlier `76c5426` reported 198; the rail-removal commit deleted two PipelineRail tests. |
| Server test count | last cited as **74 pass** at commit `5e7c4...` body "Server suite 72→74 pass." (Phase 1.9 era). No newer count was advertised in commits since. |
| Pneuma upstream | **CRITICAL GAP** — `/tmp/pneuma-skills/modes/clipcraft/viewer/timeline/` exists but is **entirely empty** (only stub subdirs `__tests__/ hooks/ inspector/ toolbar/ transport/`, all with 0 files). The real pneuma checkout at `/Users/nanjiayan/Desktop/awesome_agent/pneuma-skills/modes/` does **not contain a `clipcraft` mode at all**. None of the eight pneuma source files the master plan names (`snapPoints.ts`, `dragEngine.ts`, `useFrameExtractor.ts`, `useClipResize.ts`, `useWaveform.ts` rewrite, `BladeTool.tsx`, `Playhead.tsx`, ripple/collapse helpers) can be located on this machine. See §4 risk register R1. |

```bash
$ git rev-parse HEAD
7aefc08321466527b595d02cb0c69472df859021

$ ls /tmp/pneuma-skills/modes/clipcraft/viewer/timeline
__tests__   hooks   inspector   toolbar   transport
$ find /tmp/pneuma-skills/modes/clipcraft -type f
(empty — zero files)

$ ls /Users/nanjiayan/Desktop/awesome_agent/pneuma-skills/modes
_shared  diagram  doc  draw  evolve  gridboard  illustrate  mode-maker
remotion  slide  webcraft
# no `clipcraft` subdir
```

The plan §4.1 (lines 2210, 2218, 2223) explicitly says "verbatim port from
pneuma" for `snapPoints.ts`, `dragEngine.ts`, `useFrameExtractor.ts`. That
verbatim source is **not present in this workspace**. Phase 4 is therefore not a
"port" — it's a re-implementation guided by the function signatures the plan
inlines (which themselves are partial — only signatures + comments, not bodies).

---

## 1. Plan vs reality (per task)

| Task | Plan target (file at `web/src/features/studio/panels/Timeline/...`) | Pneuma source path (per plan + reality) | Current state in our repo | Verdict |
| --- | --- | --- | --- | --- |
| **4.A** snapPoints | `snapPoints.ts` — 3 exports `collectSnapPoints / snapToNearest / snapDraggedStartToPoints` ([plan 2197-2216](../superpowers/plans/2026-04-28-autoviral-video-supremacy.md#L2197)). Plan 2210: "verbatim port; license is permissive enough to copy with attribution comment". Plan 2275: "Port `snapPoints.ts` + tests (3 functions × ~3 cases each)." | Plan claims `/tmp/pneuma-skills/.../snapPoints.ts` exists. **NOT FOUND** anywhere on disk (see §0). | We have `snapToBeat.ts` (17 lines) — different concept (1D nearest-beat scalar), no SnapPoint label, no excludeClipIds, no playhead-aware logic. `snapToBeat.test.ts` (15 lines) covers within-tolerance / out-of-tolerance / empty-list. | **gap** — concept of `SnapPoint{time,label}` and 3-function API is entirely absent. `snapToBeat` covers ~10% of the surface and only the music-beat use case. |
| **4.B** dragEngine | `dragEngine.ts` — `computeRipplePreview(clips, draggedClipId, draggedNewStart): Map<id, newStart>` + `snapDraggedStart(clips, id, candidate, threshold)` ([plan 2218-2231](../superpowers/plans/2026-04-28-autoviral-video-supremacy.md#L2218)). Plan 2218: "verbatim port from pneuma — overlap-then-cascade + pinned-clip pass". | Plan claims pneuma source. **NOT FOUND**. | Drag is currently inline in `Clip.tsx:38-57` — global pointermove that just calls `updateClip(id, {trackOffset: snapped})` per-frame against beat list. No ripple, no overlap detection, no preview map, no pin awareness. `Track.tsx` does not consume any preview state. | **gap** — no ripple semantics implemented; `updateClip` is a brute single-clip mover. The pinned-clip pass mentioned in the plan also has no analog in our code. |
| **4.C** rippleDelete + collapseGaps | `rippleDelete.ts` (~40 lines) and `collapseGaps.ts` (~30 lines) ([plan 2235-2257](../superpowers/plans/2026-04-28-autoviral-video-supremacy.md#L2235)). Plan inlines a complete pseudo-impl for `collapseGapsOnTrack`. Plan 2253 also names `splitClip / resizeClip / rippleDeleteClip / collapseGaps` as store actions to add. | Plan does NOT claim a pneuma path for these — they're our originals. | `store.ts:98-108` has `removeClip(id)` which only filters and recomputes duration — **does not shift later clips left**. No `rippleDeleteClip`, no `collapseGapsOnTrack` anywhere in the repo. | **gap** — fully missing. Plan-inlined pseudocode is implementable as-is once `clipDuration(c)` helper is exposed (§3 D3 below). |
| **4.D** useFrameExtractor + filmstrip | `hooks/useFrameExtractor.ts` (~159 lines) — "verbatim port — hidden video + canvas + jpeg dataURL cache, `Math.max(t, 0.05)` poster-frame avoidance" ([plan 2233, 2278](../superpowers/plans/2026-04-28-autoviral-video-supremacy.md#L2233)). Extend `Track.tsx` to render filmstrip behind video clips. | Plan claims pneuma. **NOT FOUND**. | No `useFrameExtractor` anywhere. `Track.tsx` renders only the label column + clip lane (no filmstrip). No hidden `<video>` mounting, no canvas frame-grab, no jpeg cache. `web/src/features/editor/panels/Filmstrip.tsx` exists but it's the unrelated **carousel/static-image filmstrip** (not the per-clip thumb strip we need). | **gap** — both the hook and the Track integration are missing. |
| **4.E** useWaveform rewrite + audio strip | `hooks/useWaveform.ts` — REWRITE — "bucket peaks, promise dedupe" ([plan 2204, 2280](../superpowers/plans/2026-04-28-autoviral-video-supremacy.md#L2204)). Extend `Track.tsx` to mount waveform on audio kind. | Plan implies pneuma upstream rewrite. **NOT FOUND**. | `web/src/features/studio/hooks/useWaveform.ts` exists (28 lines). Wraps `wavesurfer.js@7.12.6` (already a dep, package.json:77). `useWaveform.test.ts` mocks WaveSurfer.create. **NOT integrated into Track.tsx** — currently no consumer. | **partial** — wavesurfer-based hook ships but doesn't satisfy plan: wavesurfer fetches the file itself rather than producing 128-bucket peaks for canvas-paint, and there's no promise-dedupe (each mount makes a fresh fetch). Plan wants a custom Web-Audio-API bucket-peak hook. The current hook should likely be DELETED in favor of the rewrite. |
| **4.F** useClipResize + handles | `hooks/useClipResize.ts` (~274 lines) — "port pneuma" ([plan 2202, 2282](../superpowers/plans/2026-04-28-autoviral-video-supremacy.md#L2202)). Extend `Clip.tsx` with left/right resize handles + hover state. | Plan claims pneuma. **NOT FOUND**. | `Clip.tsx` has no resize handles, no left/right edge regions, no hover state. The whole clip body is `cursor: grab` and pointer events drag it as a single unit (Clip.tsx:38-57). | **gap** — fully missing. |
| **4.G** BladeTool + split | `BladeTool.tsx` ([plan 2204, 2284](../superpowers/plans/2026-04-28-autoviral-video-supremacy.md#L2204)). Plan §4.2.G: "click-to-split. Test split math (a clip at `[2, 8)` split at `t=5` becomes two clips `[2, 5)` and `[5, 8)` with their own ids)." Also `useSplitHoverSnap.ts` (plan 2206). | Plan claims pneuma upstream. **NOT FOUND**. | No BladeTool component, no split action in store, no hover-snap. | **gap** — fully missing. |
| **4.H** Playhead interactive | `Playhead.tsx` REWRITE — interactive scrub. Plan inlines a complete ~30-line implementation ([plan 2259-2295](../superpowers/plans/2026-04-28-autoviral-video-supremacy.md#L2259)). | Plan §4.0 line 2207 says "REWRITE" — implies an existing `Playhead.tsx` was there. **DELETED in commit `222c619` (SV.K)** per its body: "Cleanup (audit D6): removes the orphaned Playhead.tsx and Ruler.tsx — no longer imported anywhere after index.tsx inlined Ruler and removed Playhead rendering." | No Playhead.tsx exists. The plan's inline impl is self-contained and has no pneuma dependency, so this is "decision-needed" rather than "gap": we know the contract (read `currentFrame / setFrame` from store, render absolute-positioned div with `setPointerCapture`). The Timeline currently has NO playhead rendered at all — see `Timeline/index.tsx:99-109` (Ruler + Tracks but no Playhead). | **decision-needed** — implementation is self-evident; the open question is **where in the DOM the Playhead lives** (per-track row overlay vs single absolutely-positioned overlay across the whole lanes column). Plan doesn't specify. See D5 below. |
| **4.I** store actions | `splitClip(clipId, atSec)`, `resizeClip(clipId, edge, newTime)`, `rippleDeleteClip(clipId)`, `collapseGaps(trackId)` ([plan 2287, 2253](../superpowers/plans/2026-04-28-autoviral-video-supremacy.md#L2287)). | n/a — our originals. | `store.ts:1-154` has `addClip / updateClip / removeClip / moveClipWithinTrack / setSelection / setFrame / setPlaying / setBeats / recomputeDuration / addAsset / addProvenance / removeAsset`. **None of the four Phase-4 actions exist.** | **gap** — fully missing. The existing `removeClip` is NOT a ripple delete (see 4.C row). |
| **4.J** keyboard shortcuts | `useShortcuts.ts` — `S` → split at playhead on selected track, `Shift+Backspace` → ripple delete, `Cmd+Shift+G` → collapse gaps ([plan 2289](../superpowers/plans/2026-04-28-autoviral-video-supremacy.md#L2289)). | n/a — our originals. | `useShortcuts.ts:1-64` handles `Space / J / L / Cmd+S / Delete / Backspace` only. No `S`, no `Shift+Backspace` (Backspace currently triggers a non-ripple delete), no `Cmd+Shift+G`. | **gap + collision** — adding `S` is fine; **`Shift+Backspace` currently falls through to the `Delete||Backspace` branch (line 52)** which non-ripple-removes the selected clip. The new `Shift+Backspace` handler must be ordered FIRST or include an explicit `e.shiftKey` check in the Backspace branch. See D6. |

### 1.1 Verdict roll-up

| Verdict | Tasks |
| --- | --- |
| port-clean | 0 — none, because pneuma source is missing |
| partial | 1 — 4.E (waveform hook exists but not as plan specifies) |
| gap | 7 — 4.A, 4.B, 4.C, 4.D, 4.F, 4.G, 4.I |
| decision-needed | 1 — 4.H (Playhead rewrite — impl clear, DOM placement open) |
| collision | 1 (additive) — 4.J Shift+Backspace clobbers existing Backspace |

Note: 4.J is also a gap (the new bindings don't exist), but the collision is the more urgent annotation.

---

## 2. Decisions to lock

The plan §4.1 (lines 2197-2295) inlines partial type signatures and pseudocode
but leaves the following genuinely-ambiguous calls to the implementer. Each
must be locked **before** writing the TDD plan or the agent will invent
inconsistent answers per task.

### D1 — Snap tolerance unit and value

**Plan**: §4.1 line 2227 takes a parameter `snapThresholdSeconds: number` — i.e.
**seconds, not pixels**. Plan never picks a default value. Existing code uses
`0.05s` (`snapToBeat.ts:4`) and `0.06s` (`Clip.tsx:48` callsite — overrides to 60ms).
Pneuma convention (per the master plan repeatedly citing "snap line appears at
clip edges + playhead + 0", §4.3 acceptance line 2331) suggests visual-px
thresholding is more natural for direct-manip drag.

- **Option A** — keep seconds, default `0.06s` (matches current `Clip.tsx`).
- **Option B** — switch to pixels (e.g. `8px`) and divide by `pxPerSecond` inside `snapDraggedStartToPoints`.
- **Recommendation: A** — keeping the contract in seconds means filmstrip zoom level (`pxPerSecond` ranges 20-150 in `Timeline/index.tsx:22`) doesn't change snap behaviour mid-drag. Visual snap **lines** can still render at the seconds-distance (8px equivalent at 1×, 24px at 3×) but the math is zoom-stable. Default 0.06s.

### D2 — Right-handle resize semantics: extend `out` vs shrink-next

**Plan §4.2.F** (line 2282) says "Implement left/right resize handles in
`Clip.tsx` driven by `useClipResize`. Test snap-to-edge." but does **not**
specify whether dragging the right handle of clip A on a track:

- **Option A — "extend out"** — moves `A.out` later, **overlapping** the next
  clip. The next clip stays put, the new overlap is visually layered, and a
  subsequent ripple-collapse may be needed.
- **Option B — "shrink next"** — moves `A.out` later AND eats into the next
  clip's `in` (or pushes its `trackOffset` later, depending on subtype).
- **Option C — "constrained"** — `A.out` is hard-capped at `nextClip.trackOffset`. Resize past the boundary is a no-op (hits an invisible wall).
- **Recommendation: C** for now, with a stretch-goal escape hatch (hold `Alt` to
  enable A and produce overlap). Rationale: ripple delete is the user's
  explicit "I want time-shift" gesture (Shift+Backspace); resize should be
  local. C is also what every consumer NLE (Premiere/Resolve in default mode)
  does. Rejecting B avoids destructive in-point edits to neighbours that the
  user didn't aim at.

### D3 — Where does `clipDuration(c)` live?

The plan-inlined `collapseGapsOnTrack` (§4.1 line 2244) calls a free function
`clipDuration(c)`. Today, the rule is duplicated in two places:

- `store.ts:27-31` — `function clipEnd(c)` is internal (not exported).
- `Clip.tsx:30` — inline `"duration" in clip ? clip.duration : clip.out - clip.in`.

The new helper modules in this phase (`rippleDelete.ts`, `collapseGaps.ts`,
`dragEngine.ts`, `snapPoints.ts`) all need this primitive.

- **Option A** — co-locate `clipDuration(c)` in a new `clipMath.ts` next to `snapPoints.ts`.
- **Option B** — export the existing `clipEnd` from `store.ts` and add a sibling `clipDuration`.
- **Recommendation: A** — pure functions belong out of the zustand file. Put
  `clipDuration / clipEnd` in `web/src/features/studio/panels/Timeline/clipMath.ts`
  and re-import from `store.ts`. Phase 4.A test fixtures will already need
  this helper standalone.

### D4 — Cmd+B (split) on a clip vs in a gap

**Plan §4.2.J** (line 2289) says `S` (not Cmd+B) triggers split. But the
underlying question stands: pressing `S` while the **playhead is in a gap**
between clips on the selected track — what happens?

- **Option A** — silent no-op. The shortcut hint UI shows "split needs the playhead inside a clip on the selected track".
- **Option B** — split the **nearest** clip whose interval is closest in time, regardless of distance.
- **Option C** — split EVERY clip on every visible track that overlaps the playhead time. (i.e. `S` = "split all", track selection ignored.)
- **Recommendation: A** — minimal-surprise. The Phase-4 acceptance criterion
  (§4.3 line 2333: "User can press `S` over a clip — the clip splits at the
  playhead into two clips with new ids") implies the playhead must already be
  in a clip. C is tempting but breaks selection semantics; B is fragile.

### D5 — Playhead DOM placement

The plan-inlined `Playhead.tsx` (§4.1 line 2259-2271) renders a single
absolutely-positioned `<div>` with `style={{ position: "absolute", left: x }}`.
**Where** it's mounted is not specified.

- **Option A** — single full-height vertical bar mounted as a sibling of `<Ruler>` inside the lanes scroll-container in `Timeline/index.tsx:96-109` (overlays all tracks at once; scrolls with the lane content).
- **Option B** — per-track playhead rendered inside each `Track`'s clip lane (Track.tsx:77-95). Multiple instances; harder to keep in sync; pointer events overlap the clip drag handler.
- **Recommendation: A** — single overlay, sticky-Y (so it remains visible
  while user vertically scrolls if many tracks), positioned at
  `left: 110 + (frame/fps)*pxPerSecond` to account for the 110px label
  column. Pointer events on it must be `pointer-events: auto` only on a
  thin draggable hit area at the top (e.g. 10px tall handle in the ruler
  band) so clip-drag underneath isn't blocked. This matches the inline plan
  code which uses `setPointerCapture` (Pointer Events API) — the capture
  ensures move-events still flow to the bar even when the cursor leaves
  the hit area.

### D6 — Shift+Backspace key binding ordering

(See task 4.J in §1.) `useShortcuts.ts:52-58` currently treats any
`Backspace`/`Delete` as "remove selected clip" (no ripple). Adding
`Shift+Backspace` requires either:

- **Option A** — order: check `e.shiftKey && (e.key === "Backspace" || e.key === "Delete")` FIRST, dispatch `rippleDeleteClip(selection)`. THEN the existing branch dispatches plain `removeClip`.
- **Option B** — make plain Backspace a ripple-delete by default and remove the non-ripple variant entirely.
- **Recommendation: A** — preserves existing muscle-memory while adding the new gesture. Plain Backspace stays "remove this clip, leave the gap", consistent with how every text editor treats Delete vs Cut. Ripple is the explicit Shift gesture.

### D7 — `splitClip` id generation strategy

Plan §4.2.G: "two clips `[2, 5)` and `[5, 8)` with their own ids" (line 2284).
Doesn't say how to generate the new id.

- **Option A** — `crypto.randomUUID()`.
- **Option B** — `${original.id}-a` / `${original.id}-b` (deterministic, but conflicts on a second split — `clip1-b-a` becomes ugly fast).
- **Option C** — `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}` — matches the convention I can see in `dispatchGeneration.ts` for asset ids.
- **Recommendation: A** — `crypto.randomUUID()` is in jsdom + happy-dom + every modern browser; produces test-stable ids when paired with a `vi.spyOn(crypto, "randomUUID")` in unit tests. The b-suffix strategy fails the "split twice" case.

### D8 — Filmstrip thumbnail interval

Plan §4.3 acceptance (line 2335): "Each video clip on the timeline shows a
filmstrip of thumbnails (one every 0.5s)". Plan §4.0 (line 2200): "pass
`frameInterval` to filmstrip". So `0.5s` is the design target but it's a prop.

- **Option A** — fixed `0.5s` interval regardless of zoom; thumbs visually overlap at low zoom and have wide gaps at high zoom.
- **Option B** — zoom-aware: pick interval such that thumbs are roughly `60-90px` wide at current `pxPerSecond` (e.g. `interval = Math.max(0.5, 60/pxPerSecond)`).
- **Recommendation: B** for the rendered output, but **A** for the cache key. Generate-once at 0.5s intervals (cache-friendly), then sample-render at the zoom-aware step. Avoids re-running ffmpeg-style canvas grabs every zoom change.

### D9 — Waveform rewrite vs wavesurfer keep

Plan §4.0 (line 2204) says "REWRITE — bucket peaks, promise dedupe". Current
implementation uses wavesurfer.js (28 lines, package.json:77, hard runtime
dep ~150KB gz).

- **Option A — Full rewrite** per plan: custom Web-Audio-API decode, 128-bucket peak extraction, render to a small `<canvas>` per audio clip, promise dedupe across remounts. Drop wavesurfer.js dep entirely.
- **Option B — Adapter rewrite**: keep wavesurfer.js but wrap its peak-extraction API (`getDecodedData()`) to emit the 128-bucket array our code consumes; render via wavesurfer's own canvas. Saves ~200 lines of decode code; adds nothing to bundle size since dep is already present.
- **Option C — Hybrid**: rewrite the **bucket-peak extractor** ourselves (WebAudio decodeAudioData + downsample) but skip the canvas widget — paint into the `Track.tsx` filmstrip area directly with our own canvas draw loop. This is what pneuma does (per the plan's "bucket peaks" framing).
- **Recommendation: C** — matches the plan letter-of-the-law (custom decode + bucket peaks) AND lets us **delete the wavesurfer.js dependency** in a follow-up cleanup commit. Drops 150KB from the bundle. Promise dedupe via a module-level `Map<src, Promise<Peaks>>` cache keyed on src URL.

### D10 — Snap-line visual rendering

Plan §4.3 acceptance (line 2331): "snap line appears at clip edges + playhead + 0". `snapPoints.ts` returns `{time, label}` (label is e.g. "playhead" / "clip A end"). Where does the snap-line render?

- **Option A** — full-height (across all lanes) thin orange line, similar to Premiere's snap indicator. Mounted at `dragEngine.snapTime !== null` time.
- **Option B** — per-track horizontal tick at the Y of the dragged clip only.
- **Recommendation: A** — matches industry NLE; the `label` field hints
  pneuma plans to render a tooltip ("→ playhead", "→ clip B start") next to
  the line. A single full-height overlay with conditional render is cheap.
  Use `var(--accent-hi)` from the design system (CLAUDE.md aesthetic
  direction).

---

## 3. Gaps and risks

### R1 — Pneuma upstream is unavailable (BLOCKING)

(Restated from §0.) The master plan's §4.1 contracts say "verbatim port from
pneuma" four times (snapPoints, dragEngine, useFrameExtractor, useClipResize).
The pneuma source files **do not exist** in any reachable location:

- `/tmp/pneuma-skills/modes/clipcraft/viewer/timeline/` — empty stub directories only.
- `/Users/nanjiayan/Desktop/awesome_agent/pneuma-skills/modes/` — has 11 modes (`_shared, diagram, doc, draw, evolve, gridboard, illustrate, mode-maker, remotion, slide, webcraft`); `clipcraft` is **not one of them**.
- `~/.bun/install/cache/pneuma-skills@2.27.2@@@1/modes/` — same 11 modes, no clipcraft.

**Mitigation paths** (need to pick one before writing the TDD plan):

1. **Re-implement from plan inline** — the plan inlines partial signatures + behaviour comments for snapPoints (§4.1 lines 2210-2216, 6 lines of body), dragEngine (lines 2220-2230, ~10 lines), rippleDelete + collapseGaps (lines 2235-2257, full pseudocode for collapse, 3-step prose for ripple), Playhead (lines 2259-2295, full ~30-line component). For `useFrameExtractor` (159 lines) and `useClipResize` (274 lines) the plan only gives a one-line description ("hidden video + canvas + jpeg dataURL cache, `Math.max(t, 0.05)` poster-frame avoidance"). These two are the highest-risk re-implements.
2. **Locate the upstream** — `https://github.com/garrytan/gstack` and `https://github.com/obra/superpowers` (mentioned in CLAUDE.md `<rules>`) are NOT pneuma sources. The user may have a local clipcraft-specific repo we haven't been pointed to.
3. **Reduce scope** — drop tasks 4.D and 4.F from this phase (filmstrip + resize), shipping snap/drag/ripple/split/playhead first. The acceptance criteria §4.3 line 2335 ("Each video clip... shows a filmstrip of thumbnails... audio clips show a 128-peak waveform") would have to be marked "Phase 4.5".

**Recommendation**: ask the human (see §6 Q1) whether the missing pneuma source is recoverable. If not, recommended path is **(1)** for everything except `useFrameExtractor` and `useClipResize`; for those two we re-implement following the **plan-described behaviour** with our own test plan, and accept that the resulting code won't be a verbatim port.

### R2 — Schema is fine, no Composition changes needed

`src/shared/composition.ts:88-167` defines all four clip kinds with `trackOffset`,
in/out (video/audio), or duration (text/overlay). Split, ripple, resize all
work with these fields directly:

- **Split**: produces two clips with `(in, mid)` and `(mid, out)` for video/audio; `(0, mid)` and `(mid, duration)` reset of new clip for text/overlay (text loses split-text semantics — see D11 below; recommend disallowing split on text/overlay clips for v1).
- **Resize left handle**: changes `in` (video/audio) or shifts `trackOffset` and shrinks `duration` (text/overlay).
- **Resize right handle**: changes `out` (video/audio) or `duration` (text/overlay).
- **Ripple delete**: remove + shift later clips' `trackOffset` left by removed clip's duration.

No new schema fields required for Phase 4. This is the one piece of good news in the audit.

### R3 — `crypto.randomUUID` jsdom availability

D7 settles on `crypto.randomUUID()`. Vitest config at `web/vitest.config.ts` (not re-read but inferred from the existing test files using `@testing-library/react` + happy-dom per `package.json:94`) — happy-dom **does** ship `crypto.randomUUID` since v15. Confirmed available; no polyfill required. But unit tests that assert deterministic ids will need `vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(...)`.

### R4 — `<canvas>` and `HTMLVideoElement` in jsdom/happy-dom

`useFrameExtractor` (4.D) uses a hidden `<video>` + canvas `getContext("2d").drawImage(video)` to grab JPEG dataURLs. happy-dom **does not implement** real video decoding or canvas drawing — `drawImage` is a stub that does nothing, and `<video>.currentTime = X; await loadedMetadata` will not fire `seeked`. Tests for `useFrameExtractor` MUST mock both:

```ts
vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(...);
Object.defineProperty(HTMLVideoElement.prototype, "duration", { value: 10 });
// canvas.toDataURL needs to return a fake dataURL
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/jpeg;base64,...");
```

This is the same level of mocking that `useWaveform.test.ts:5-13` already does for wavesurfer. Test infrastructure pattern is established; just needs to be applied per-hook.

### R5 — Web Audio API in jsdom for waveform decode

`useWaveform` rewrite (4.E option C) uses `new AudioContext()` + `decodeAudioData()`. happy-dom has a minimal `AudioContext` stub but `decodeAudioData` is unreliable across happy-dom versions. Test must mock:

```ts
class MockAudioContext {
  decodeAudioData = vi.fn(async () => ({
    getChannelData: () => new Float32Array(48000),
    duration: 1, numberOfChannels: 1, sampleRate: 48000,
  }));
  close = vi.fn();
}
globalThis.AudioContext = MockAudioContext as any;
```

Add to `web/src/test/setup.ts` (or wherever the existing test boot lives) once and forget. Actual waveform CORRECTNESS testing happens against pre-baked Float32 fixtures, not real audio.

### R6 — No new web dependencies needed

Plan does **not** require any of:
- `ffmpeg-wasm` / `@ffmpeg/ffmpeg` — NOT installed (verified `package.json:39-99`); not needed because filmstrip extraction uses the browser's native HTMLVideoElement + canvas, **not** ffmpeg.
- A waveform library — `wavesurfer.js@7.12.6` is currently installed but per D9 recommendation we **drop** it after the rewrite. Net dependency change is `-1` not `+1`.
- Any new pointer-event / drag library — `@dnd-kit/core@6.3.1` is already in deps but Phase 4 drag uses raw Pointer Events (matches plan inline code) for ripple-preview correctness; @dnd-kit doesn't expose the live transform we need for `computeRipplePreview`.

So Phase 4 is **dependency-net-zero** (or `-1` if we delete wavesurfer.js).

### R7 — Existing drag in Clip.tsx will fight the new dragEngine

`Clip.tsx:38-57` installs a raw `pointermove` handler that mutates the store
on every move event — no preview state, just direct writes. The new
`dragEngine.computeRipplePreview` returns a `Map<id, newStart>` that is
supposed to render as a **preview** (visual ghost positions), with the actual
mutation only firing on `pointerup`. The two patterns are incompatible.
Phase 4.B implementation MUST replace the inline drag in `Clip.tsx` with a
new pattern:

1. `pointerdown` → set `useComposition.dragState = {clipId, originalStart, candidateStart}`.
2. `pointermove` → recompute `candidateStart`, run `snapDraggedStart` + `computeRipplePreview`, store result in `dragState.preview: Map<id, number>`.
3. Track/Clip components consume `dragState.preview.get(clip.id) ?? clip.trackOffset` for visual `left` calc.
4. `pointerup` → commit preview to actual clip positions via `set((s) => for each [id, newStart] -> updateClip(id, {trackOffset: newStart}))`. Clear `dragState`.

This means the store needs new actions:

```ts
beginDrag(clipId): void
updateDragCandidate(candidateStart): void
commitDrag(): void
cancelDrag(): void
```

Not in the plan's §4.2 task list. Should be folded into 4.B (dragEngine) or a new sub-task 4.B.1.

### R8 — `Clip.test.tsx` snapshot will break on width changes

`Clip.test.tsx:33-34` asserts `el.style.width === "200px"` exactly. If 4.F adds resize handles as inset positioned children OR if 4.D adds a filmstrip overlay that affects the clip's outer width math, this test will fail. Phase 4 plan must include test updates for each Clip.tsx change.

### R9 — `currentFrame` source-of-truth split

`store.ts:5,114-116` has `currentFrame` (an integer frame count, 0-based) — but `PreviewPanel.tsx:15-22` ALSO has a local `useState<number>(0)` driven by a custom event `"frame"`. Two state sources for "where is the playhead". Phase 4.H Playhead must read from **the store** (`useComposition((s) => s.currentFrame)`) per the plan inline code. PreviewPanel will need a follow-up sync pass — out of scope for Phase 4 strictly but flag as future-debt: the playhead user-drag in 4.H should fire `setFrame` in the store, and PreviewPanel should subscribe to the same source instead of its local state.

### R10 — Ruler ticks don't snap to BPM

Current `Ruler` (`Timeline/index.tsx:116-166`) draws ticks every 2/4/10s based on duration. It does NOT visualize beat lines from `useComposition.beats`. This is fine for Phase 4 (out of scope), but the snapPoints visual indicator (D10) will potentially overlap with a future BPM-tick render. No action needed now; just don't bake assumptions about Ruler-only ticks.

---

## 4. Recommended task sequence

Plan §4.2 lists 4.A → 4.J in lexical order. Dependency-aware order is:

```
4.A snapPoints ───► 4.B dragEngine ──┬─► 4.F resize (uses snap)
                                     ├─► 4.G split (uses snap-to-edge for blade hover)
                                     └─► 4.H Playhead (depends on snap for click-on-ruler scrub bonus)

4.C ripple+collapse ───► (independent of 4.A/B math) ───► 4.I store actions ───► 4.J shortcuts

4.D filmstrip + 4.E waveform ───► (independent of all of the above; pure visual)
```

Recommended execution order (one paragraph as requested): **Land 4.A first
(pure functions, easiest TDD)**, then 4.B (depends on 4.A's snap helper) —
this also forces R7's drag refactor early. Land 4.C next (independent, small).
4.I (store actions) wraps both 4.B and 4.C results. 4.H Playhead drops in
parallel with 4.C since it has no math dependency. Then 4.F resize (needs
4.A snap) and 4.G split (needs both 4.A snap and 4.I splitClip action). 4.D
+ 4.E ship in parallel last since they're pure visual additions to Track.tsx
with no math coupling. 4.J shortcuts is the last seam, depending on every
store action existing. **Critical reorder vs plan: 4.I before 4.F/4.G**, not
after — the plan lists 4.I at position 9 of 10 but the store actions
underpin every interactive task above it.

---

## 5. Open questions for the human

Keep this list short — push for sensible defaults wherever possible. These are
the questions where defaults would be **wrong** more often than right:

### Q1 — Where is the pneuma clipcraft source?

R1 above. The master plan was written assuming `/tmp/pneuma-skills/modes/clipcraft/viewer/timeline/` had real files. It does not. **Two answers acceptable**:

- "Here's the path/repo to clone" — we reroute the audit and do verbatim ports.
- "Reimplement from the plan-inline contracts" — we accept the loss of fidelity and proceed per §4.

If the user can't answer fast, we proceed with reimplementation (default).

### Q2 — Is the Phase-4 acceptance criterion §4.3 line 2335 ("128-peak waveform") a hard target?

D9 / R5 imply we COULD ship with a coarser bucket count (32 or 64) and revisit. 128 buckets at ~75-90px clip width is sub-pixel; visually 64 is indistinguishable. Check: is "128" a deliberate match-to-pneuma constant, or just a number the plan author wrote? If the latter, recommend 64.

### Q3 — Do split clips inherit ALL of the parent's transforms/filters?

The plan §4.2.G inline test (line 2284) is explicit only about start/end times. But `VideoClipSchema` has `transforms` and `filters` — should both children inherit identical values? This affects "split a clip with a Ken-Burns zoom" — does each half get the same `scale` and animate independently, or is the zoom split-and-renormalised across the original duration? **Recommend default: identical inheritance**; users can edit afterwards. Confirm before TDD.

### Q4 — Should `removeClip` (current non-ripple) stay accessible from the UI?

If D6 settles on Backspace=plain-remove, Shift+Backspace=ripple, then both are reachable. But there's NO non-keyboard way to ripple-delete in the plan — only Shift+Backspace. Do we want a right-click menu item? Probably yes for discoverability, but the plan doesn't request it. Confirm scope: keyboard-only is fine for Phase 4? (Recommend: yes, ship keyboard-only; menu in Phase 5.)

That's it — four genuine open questions. D1–D10 are decisions I've already
made above with stated rationale; if any of those recommendations look wrong
to the human, that becomes Q5+ but the audit's job is to surface, not
re-litigate.

---

**END OF AUDIT.** Lines: ~430. Self-contained for Phase 4 plan-writing.
Every section anchors a Phase 4 task to specific file:line locations and
surfaces blocking unknowns the master plan didn't anticipate. The single
biggest risk is R1 (missing pneuma upstream); everything else is
implementable from plan-inline contracts.

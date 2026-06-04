import { describe, it, expect, beforeEach, vi } from "vitest";
import { useComposition } from "../store";
import { useToastStore } from "@/stores/toast";
import { makeEmptyComposition } from "../types";
import {
  makeAssetEntry,
  makeAudioClip,
  makeCompositionWithClips,
  makeVideoClip,
  makeTextClip,
} from "../../../test/composition-fixtures";

describe("studio store provenance actions", () => {
  beforeEach(() => {
    useComposition.setState({
      comp: makeEmptyComposition({ workId: "w_test" }),
      selection: null,
      currentFrame: 0,
      isPlaying: false,
      beats: [],
    });
  });

  it("addAsset appends to comp.assets", () => {
    useComposition.getState().addAsset({
      id: "asset-x",
      uri: "/api/works/w_test/assets/clips/x.mp4",
      kind: "video",
      metadata: {},
      status: "ready",
    });
    expect(useComposition.getState().comp!.assets).toHaveLength(1);
    expect(useComposition.getState().comp!.assets[0].id).toBe("asset-x");
  });

  it("addAsset is idempotent on id (no-op when asset already present)", () => {
    const a = {
      id: "asset-dup",
      uri: "/u",
      kind: "image" as const,
      metadata: {},
      status: "ready" as const,
    };
    useComposition.getState().addAsset(a);
    useComposition.getState().addAsset(a);
    expect(useComposition.getState().comp!.assets).toHaveLength(1);
  });

  it("addProvenance appends to comp.provenance", () => {
    useComposition.getState().addProvenance({
      toAssetId: "asset-x",
      fromAssetId: null,
      operation: {
        type: "generate",
        actor: "agent",
        timestamp: "2026-04-28T10:00:00Z",
        params: {},
      },
    });
    expect(useComposition.getState().comp!.provenance).toHaveLength(1);
  });

  it("removeAsset removes the asset and edges with that toAssetId, but preserves edges deriving FROM it", () => {
    const s = useComposition.getState();
    s.addAsset({
      id: "asset-y",
      uri: "/y",
      kind: "image",
      metadata: {},
      status: "ready",
    });
    s.addProvenance({
      toAssetId: "asset-y",
      fromAssetId: null,
      operation: { type: "generate", actor: "agent", timestamp: "t", params: {} },
    });
    s.addProvenance({
      toAssetId: "asset-z",
      fromAssetId: "asset-y",
      operation: { type: "derive", actor: "agent", timestamp: "t", params: {} },
    });
    s.removeAsset("asset-y");
    expect(useComposition.getState().comp!.assets).toHaveLength(0);
    // Edges where toAssetId === asset-y are removed; edges that DERIVED from
    // asset-y keep their fromAssetId so the lineage stays visible (broken-link
    // state is reconciled by the dive view in Phase 5).
    expect(useComposition.getState().comp!.provenance).toHaveLength(1);
    expect(useComposition.getState().comp!.provenance[0].toAssetId).toBe("asset-z");
  });
});

describe("composition store — drag-preview actions (Phase 4.B)", () => {
  beforeEach(() => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 3, in: 0, out: 2 });
    useComposition.setState({
      comp: makeCompositionWithClips([a, b]),
      selection: null,
      currentFrame: 0,
      isPlaying: false,
      beats: [],
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

  it("beginDrag is a no-op for unknown clipIds", () => {
    useComposition.getState().beginDrag("missing");
    expect(useComposition.getState().dragState).toBeNull();
  });

  it("updateDragCandidate recomputes preview + snap", () => {
    const s = useComposition.getState();
    s.beginDrag("a");
    s.updateDragCandidate(2.5);
    const ds = useComposition.getState().dragState!;
    expect(ds.candidateStart).toBeCloseTo(2.5);
    // a's new start may snap toward b.start=3 (within 0.06? 2.5 vs 3 is 0.5 away — no snap).
    expect(ds.preview.get("a")).toBeCloseTo(2.5);
    // a ends at 4.5; b at 3 must cascade to >= 4.5
    expect(ds.preview.get("b")!).toBeGreaterThanOrEqual(4.499);
  });

  it("updateDragCandidate snaps to a neighbouring clip edge within threshold", () => {
    // Use a 3-clip layout so we can pick a candidate where snapping to a
    // start is unambiguously closer than snapping the end.
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 3, in: 0, out: 1 });
    useComposition.setState({
      comp: makeCompositionWithClips([a, b]),
      selection: null,
      currentFrame: 0,
      isPlaying: false,
      beats: [],
      dragState: null,
    });
    const s = useComposition.getState();
    s.beginDrag("a");
    // candidate 2.97 — start vs b.start=3 → delta 0.03; end (=4.97) vs
    // b.end=4 → delta 0.97 (out of range). Only b.start can fire.
    s.updateDragCandidate(2.97);
    const ds = useComposition.getState().dragState!;
    expect(ds.preview.get("a")).toBeCloseTo(3);
    expect(ds.snapTime).toBeCloseTo(3);
  });

  it("commitDrag flushes preview into clips and clears state", () => {
    const s = useComposition.getState();
    s.beginDrag("a");
    s.updateDragCandidate(2.5);
    s.commitDrag();
    const after = useComposition.getState();
    expect(after.dragState).toBeNull();
    const a = after
      .comp!.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === "a")!;
    const b = after
      .comp!.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === "b")!;
    expect(a.trackOffset).toBeCloseTo(2.5);
    expect(b.trackOffset).toBeCloseTo(4.5);
    // Composition duration recomputed to cover the cascaded clip.
    expect(after.comp!.duration).toBeCloseTo(6.5);
  });

  it("cancelDrag discards preview without mutating clips", () => {
    const s = useComposition.getState();
    s.beginDrag("a");
    s.updateDragCandidate(2.5);
    s.cancelDrag();
    const after = useComposition.getState();
    expect(after.dragState).toBeNull();
    const a = after
      .comp!.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === "a")!;
    const b = after
      .comp!.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === "b")!;
    expect(a.trackOffset).toBeCloseTo(0);
    expect(b.trackOffset).toBeCloseTo(3);
  });

  // #3 — the clip BODY now owns cross-track moves. beginDrag seeds
  // targetTrackId=null; updateDragTarget records a hovered same-kind lane;
  // commitDrag applies BOTH the horizontal trackOffset AND the lane move.
  it("beginDrag initialises targetTrackId to null", () => {
    useComposition.getState().beginDrag("a");
    expect(useComposition.getState().dragState!.targetTrackId).toBeNull();
  });

  it("updateDragTarget records / clears the cross-track move target", () => {
    const s = useComposition.getState();
    s.beginDrag("a");
    s.updateDragTarget("t_other");
    expect(useComposition.getState().dragState!.targetTrackId).toBe("t_other");
    s.updateDragTarget(null);
    expect(useComposition.getState().dragState!.targetTrackId).toBeNull();
  });

  it("updateDragTarget is a no-op when no drag is active", () => {
    useComposition.getState().updateDragTarget("t_other");
    expect(useComposition.getState().dragState).toBeNull();
  });

  it("cancelDrag clears a recorded targetTrackId", () => {
    const s = useComposition.getState();
    s.beginDrag("a");
    s.updateDragTarget("t_other");
    s.cancelDrag();
    expect(useComposition.getState().dragState).toBeNull();
  });

  it("commitDrag with a targetTrackId moves the clip to the lane AND keeps the scrubbed offset", () => {
    // Two same-kind audio lanes (A1/A2 in makeEmptyComposition) — the exact
    // same-kind pair moveClipToTrack uses. Seed an audio clip on A1.
    const c = makeEmptyComposition({ workId: "w" });
    const audioLanes = c.tracks.filter((t) => t.kind === "audio");
    const [a1, a2] = audioLanes;
    a1.clips.push(makeAudioClip({ id: "au", trackOffset: 0, in: 0, out: 4 }));
    useComposition.setState({
      comp: c,
      selection: null,
      currentFrame: 0,
      isPlaying: false,
      beats: [],
      dragState: null,
    });

    const s = useComposition.getState();
    s.beginDrag("au");
    s.updateDragCandidate(1.5); // scrub right to t=1.5
    s.updateDragTarget(a2.id); // retarget A2
    s.commitDrag();

    const after = useComposition.getState();
    expect(after.dragState).toBeNull();
    const a1Clips = after.comp!.tracks.find((t) => t.id === a1.id)!.clips;
    const a2Clips = after.comp!.tracks.find((t) => t.id === a2.id)!.clips;
    expect(a1Clips).toHaveLength(0); // detached from source
    expect(a2Clips).toHaveLength(1); // attached to target
    expect(a2Clips[0].id).toBe("au");
    expect(a2Clips[0].trackOffset).toBeCloseTo(1.5); // horizontal scrub preserved
  });

  it("commitDrag re-guards kind: a stale cross-kind targetTrackId never moves the clip", () => {
    // Audio clip on A1, target a VIDEO lane — the inline kind guard must reject
    // the move even though targetTrackId is set (defence vs a stale target).
    const c = makeEmptyComposition({ workId: "w" });
    const a1 = c.tracks.find((t) => t.kind === "audio")!;
    const videoLane = c.tracks.find((t) => t.kind === "video")!;
    a1.clips.push(makeAudioClip({ id: "au", trackOffset: 0, in: 0, out: 4 }));
    useComposition.setState({
      comp: c,
      selection: null,
      currentFrame: 0,
      isPlaying: false,
      beats: [],
      dragState: null,
    });

    const s = useComposition.getState();
    s.beginDrag("au");
    s.updateDragTarget(videoLane.id);
    s.commitDrag();

    const after = useComposition.getState();
    expect(after.comp!.tracks.find((t) => t.id === a1.id)!.clips).toHaveLength(1);
    expect(after.comp!.tracks.find((t) => t.id === videoLane.id)!.clips).toHaveLength(0);
  });
});

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

  it("rippleDeleteClip is a no-op when clipId is unknown", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 3 });
    useComposition.setState({
      comp: makeCompositionWithClips([a, b]),
      selection: null,
    });
    const beforeIds = useComposition
      .getState()
      .comp!.tracks[0].clips.map((c) => c.id);
    expect(() =>
      useComposition.getState().rippleDeleteClip("missing"),
    ).not.toThrow();
    const afterIds = useComposition
      .getState()
      .comp!.tracks[0].clips.map((c) => c.id);
    expect(afterIds).toEqual(beforeIds);
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

  it("collapseGaps is a no-op when trackId is unknown", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 1, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 1 });
    useComposition.setState({
      comp: makeCompositionWithClips([a, b]),
    });
    expect(() =>
      useComposition.getState().collapseGaps("nope-no-such-track"),
    ).not.toThrow();
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.map((c) => c.trackOffset)).toEqual([1, 5]);
  });
});

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

  it("right edge of last clip with no neighbour clamps only at minDuration (no upper bound)", () => {
    // Single clip on its track — no `next` cap; should extend freely.
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    useComposition.setState({ comp: makeCompositionWithClips([a]), dragState: null });
    useComposition.getState().resizeClip("a", "right", 99);
    const aAfter = useComposition.getState().comp!.tracks[0].clips[0] as any;
    // out - in == 99 - 0 (trackOffset) = 99
    expect(aAfter.out).toBeCloseTo(99);
    // Composition duration grew to cover the new end
    expect(useComposition.getState().comp!.duration).toBeCloseTo(99);
  });

  it("minDuration prevents zero-width on left edge too", () => {
    // Try to drag the left edge past the right edge — should clamp at end - 0.05.
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    useComposition.setState({ comp: makeCompositionWithClips([a]), dragState: null });
    useComposition.getState().resizeClip("a", "left", 5); // way past the right edge (2)
    const aAfter = useComposition.getState().comp!.tracks[0].clips[0] as any;
    // trackOffset clamped to end(=2) - MIN_DUR(=0.05) = 1.95
    expect(aAfter.trackOffset).toBeCloseTo(1.95);
    // remaining duration ≥ 0.05
    expect(aAfter.out - aAfter.in).toBeGreaterThanOrEqual(0.05);
  });

  // #48 — resize is the sibling of splitClip (#46); a trim that changes the
  // clip-local window must rebase/trim keyframes via the same helper. Before
  // #48, resizeClip touched 0 keyframes, so trimming an animated clip left the
  // curve mis-aligned with the picture by `delta` seconds.
  it("left-edge trim rebases keyframes by -delta + boundary at local-0, dropping front frames (#48)", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 6 });
    useComposition.setState({ comp: makeCompositionWithClips([a]), dragState: null });
    useComposition.setState((s) => {
      (s.comp!.tracks[0].clips[0] as any).keyframes = [
        { property: "scale", time: 1, value: 1.2, easing: "linear" },
        { property: "scale", time: 5, value: 1.5, easing: "linear" },
      ];
    });
    useComposition.getState().resizeClip("a", "left", 2); // trim 2s off the front
    const aAfter = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(aAfter.trackOffset).toBeCloseTo(2);
    // boundary@0 = curve value at local 2 (linear between 1.2@1 and 1.5@5):
    //   1.2 + 0.3*((2-1)/(5-1)) = 1.275; kf@5 rebased to 5-2=3; kf@1 dropped.
    expect(aAfter.keyframes.map((k: any) => k.time)).toEqual([0, 3]);
    expect(aAfter.keyframes[0].value).toBeCloseTo(1.275);
    expect(aAfter.keyframes[1].value).toBeCloseTo(1.5);
  });

  it("right-edge trim drops keyframes past the new end + adds a boundary at the cut (#48)", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 6 });
    useComposition.setState({ comp: makeCompositionWithClips([a]), dragState: null });
    useComposition.setState((s) => {
      (s.comp!.tracks[0].clips[0] as any).keyframes = [
        { property: "scale", time: 1, value: 1.2, easing: "linear" },
        { property: "scale", time: 5, value: 1.5, easing: "linear" },
      ];
    });
    useComposition.getState().resizeClip("a", "right", 3); // newDur = 3
    const aAfter = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(aAfter.out).toBeCloseTo(3);
    // kf@1 kept; kf@5 dropped; boundary@3 = 1.2 + 0.3*((3-1)/4) = 1.35.
    expect(aAfter.keyframes.map((k: any) => k.time)).toEqual([1, 3]);
    expect(aAfter.keyframes[1].value).toBeCloseTo(1.35);
  });

  it("right-edge extend leaves in-bounds keyframes untouched (#48)", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 6 });
    useComposition.setState({ comp: makeCompositionWithClips([a]), dragState: null });
    useComposition.setState((s) => {
      (s.comp!.tracks[0].clips[0] as any).keyframes = [
        { property: "scale", time: 1, value: 1.2, easing: "linear" },
        { property: "scale", time: 5, value: 1.5, easing: "linear" },
      ];
    });
    useComposition.getState().resizeClip("a", "right", 99); // extend; no kf past 99
    const aAfter = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(aAfter.keyframes.map((k: any) => k.time)).toEqual([1, 5]);
  });

  it("leaves a clip with no keyframes untouched on trim — no empty array invented (#48)", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 6 });
    useComposition.setState({ comp: makeCompositionWithClips([a]), dragState: null });
    useComposition.getState().resizeClip("a", "left", 2);
    const aAfter = useComposition.getState().comp!.tracks[0].clips[0] as any;
    expect(aAfter.keyframes).toBeUndefined();
  });
});

describe("splitClip (Phase 4.G)", () => {
  beforeEach(() => {
    useToastStore.getState().clear();
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
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "new-id" as `${string}-${string}-${string}-${string}-${string}`,
    );
    useComposition.getState().splitClip("a", 5);
    const clips = useComposition.getState().comp!.tracks[0].clips;
    expect(clips.length).toBe(2);
    const sorted = clips
      .slice()
      .sort((x, y) => x.trackOffset - y.trackOffset);
    const [first, second] = sorted;
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

  it("is a no-op when atSec is exactly at the clip boundary (zero-width guard)", () => {
    useComposition.getState().splitClip("a", 2); // start boundary
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(1);
    useComposition.getState().splitClip("a", 8); // end boundary
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(1);
  });

  it("is a no-op when clipId is unknown", () => {
    expect(() =>
      useComposition.getState().splitClip("missing", 4),
    ).not.toThrow();
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(1);
  });

  it("surfaces a toast (ADR-009 #4) — not a silent no-op — on an illegal split", () => {
    // Boundary split → CompositionOpError; the store must SURFACE it.
    useComposition.getState().splitClip("a", 2); // start boundary (zero-width)
    expect(useComposition.getState().comp!.tracks[0].clips.length).toBe(1); // UI untouched
    const entries = useToastStore.getState().entries;
    expect(entries.length).toBe(1);
    expect(entries[0].variant).toBe("warn");
    // detail carries the op's technical message so power users can debug.
    expect(entries[0].detail).toMatch(/splitClip/);
  });

  it("surfaces a toast when the clip id is unknown", () => {
    useComposition.getState().splitClip("missing", 4);
    const entries = useToastStore.getState().entries;
    expect(entries.length).toBe(1);
    expect(entries[0].detail).toMatch(/no clip with id/);
  });

  it("inherits transforms + filters identically (audit Q3)", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "uuid-2" as `${string}-${string}-${string}-${string}-${string}`,
    );
    useComposition.setState((s) => {
      const a = s.comp!.tracks[0].clips[0] as any;
      a.transforms = { scale: 1.5, x: 5, y: 0, rotation: 0 };
      a.filters = { brightness: 0.1, contrast: 0, saturation: 0 };
    });
    useComposition.getState().splitClip("a", 4);
    const clips = useComposition.getState().comp!.tracks[0].clips as any[];
    const sorted = clips.slice().sort((x, y) => x.trackOffset - y.trackOffset);
    const [first, second] = sorted;
    expect(first.transforms.scale).toBeCloseTo(1.5);
    expect(second.transforms.scale).toBeCloseTo(1.5);
    expect(first.transforms.x).toBeCloseTo(5);
    expect(second.transforms.x).toBeCloseTo(5);
    expect(first.filters.brightness).toBeCloseTo(0.1);
    expect(second.filters.brightness).toBeCloseTo(0.1);
    vi.restoreAllMocks();
  });

  it("splits a text clip via duration (not in/out)", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "text-2" as `${string}-${string}-${string}-${string}-${string}`,
    );
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
    expect(sorted[0].trackOffset).toBeCloseTo(1);
    expect(sorted[0].duration).toBeCloseTo(2);
    expect(sorted[1].id).toBe("text-2");
    expect(sorted[1].trackOffset).toBeCloseTo(3);
    expect(sorted[1].duration).toBeCloseTo(2);
    vi.restoreAllMocks();
  });

  it("recomputes comp.duration after split", () => {
    useComposition.getState().splitClip("a", 5);
    // No change to total end (still 8) but pipeline must run
    expect(useComposition.getState().comp!.duration).toBeCloseTo(8);
  });

  it("partitions + rebases keyframes across the split instead of copying the whole array (#46)", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "kf-2" as `${string}-${string}-${string}-${string}-${string}`,
    );
    // Clip on timeline 2..8 (clip-local [0,6]). scale @ local 1 (1.2) and
    // local 5 (1.5). Split at timeline 5 → clip-local offset 3.
    useComposition.setState((s) => {
      const a = s.comp!.tracks[0].clips[0] as any;
      a.keyframes = [
        { property: "scale", time: 1, value: 1.2, easing: "linear" },
        { property: "scale", time: 5, value: 1.5, easing: "linear" },
      ];
    });
    useComposition.getState().splitClip("a", 5);
    const clips = useComposition.getState().comp!.tracks[0].clips as any[];
    const [first, second] = clips
      .slice()
      .sort((x, y) => x.trackOffset - y.trackOffset);

    // Before #46 BOTH halves carried [t=1, t=5] verbatim. Now:
    // child A keeps t=1 + a boundary at the split (local 3); no t=5.
    expect(first.keyframes.map((k: any) => k.time)).toEqual([1, 3]);
    expect(first.keyframes.some((k: any) => k.time === 5)).toBe(false);
    // child B: boundary at 0 + t=5 rebased to 5-3=2; no stray t=1.
    expect(second.keyframes.map((k: any) => k.time)).toEqual([0, 2]);
    expect(second.keyframes.some((k: any) => k.time === 1)).toBe(false);
    vi.restoreAllMocks();
  });

  it("leaves text clips (no keyframes) untouched — no empty keyframes field added (#46)", () => {
    const t = makeTextClip({ id: "t", trackOffset: 1, duration: 4 });
    useComposition.setState({
      comp: makeCompositionWithClips([t as any]),
      selection: null,
      dragState: null,
    });
    useComposition.getState().splitClip("t", 3);
    const clips = useComposition.getState().comp!.tracks[0].clips as any[];
    // text clips carry no keyframes (D8) — the split must not invent one.
    expect(clips.every((c) => c.keyframes === undefined)).toBe(true);
  });
});

describe("bladeMode flag (Phase 4.G)", () => {
  it("defaults to false", () => {
    useComposition.setState({
      comp: makeCompositionWithClips([
        makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 }),
      ]),
    });
    expect(useComposition.getState().bladeMode).toBe(false);
  });

  it("setBladeMode toggles on and off", () => {
    useComposition.getState().setBladeMode(true);
    expect(useComposition.getState().bladeMode).toBe(true);
    useComposition.getState().setBladeMode(false);
    expect(useComposition.getState().bladeMode).toBe(false);
  });
});

describe("setFrame action clamping (Phase 4.H follow-up)", () => {
  beforeEach(() => {
    useComposition.setState({
      comp: makeCompositionWithClips([
        makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 4 }),
      ]),
      currentFrame: 0,
    });
  });

  it("clamps negative frames at 0", () => {
    useComposition.getState().setFrame(-30);
    expect(useComposition.getState().currentFrame).toBe(0);
  });

  it("clamps frames above comp.duration * fps", () => {
    // comp.duration = 4, fps = 30 → max = 120
    useComposition.getState().setFrame(500);
    expect(useComposition.getState().currentFrame).toBe(120);
  });

  it("rejects NaN and Infinity without mutating state", () => {
    useComposition.getState().setFrame(60);
    useComposition.getState().setFrame(Number.NaN);
    expect(useComposition.getState().currentFrame).toBe(60);
    useComposition.getState().setFrame(Number.POSITIVE_INFINITY);
    expect(useComposition.getState().currentFrame).toBe(60);
  });

  it("rounds non-integer frames to the nearest integer", () => {
    useComposition.getState().setFrame(7.4);
    expect(useComposition.getState().currentFrame).toBe(7);
    useComposition.getState().setFrame(7.6);
    expect(useComposition.getState().currentFrame).toBe(8);
  });
});

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

describe("applyPlatformPreset (Phase 6.D)", () => {
  it("D5: updates exportPresets[0] AND aspect/width/height/fps atomically", () => {
    const comp = makeCompositionWithClips([]);
    comp.aspect = "16:9";
    comp.width = 1920;
    comp.height = 1080;
    comp.fps = 30;
    comp.exportPresets = [];
    useComposition.setState({ comp });
    useComposition.getState().applyPlatformPreset({
      id: "douyin-9-16",
      label: "抖音 9:16",
      platform: "douyin",
      width: 1080,
      height: 1920,
      fps: 30,
      videoBitrate: 8000,
      audioBitrate: 192,
      codec: "h264",
      container: "mp4",
      maxDurationSec: 60,
      loudnessTargetLufs: -14,
      safeZonePct: 0.18,
    });
    const next = useComposition.getState().comp!;
    expect(next.aspect).toBe("9:16");
    expect(next.width).toBe(1080);
    expect(next.height).toBe(1920);
    expect(next.fps).toBe(30);
    expect(next.exportPresets[0].platform).toBe("douyin");
    expect(next.exportPresets[0].videoBitrate).toBe(8000);
  });

  it("replaces an existing exportPresets[0], does not append", () => {
    const comp = makeCompositionWithClips([]);
    comp.exportPresets = [
      {
        id: "old",
        label: "old",
        platform: "custom",
        width: 1920,
        height: 1080,
        fps: 30,
        videoBitrate: 5000,
        audioBitrate: 192,
        codec: "h264",
        container: "mp4",
        loudnessTargetLufs: -14,
        safeZonePct: 0.05,
      },
    ];
    useComposition.setState({ comp });
    useComposition.getState().applyPlatformPreset({
      id: "tiktok-9-16",
      label: "TikTok",
      platform: "tiktok",
      width: 1080,
      height: 1920,
      fps: 30,
      videoBitrate: 8000,
      audioBitrate: 192,
      codec: "h264",
      container: "mp4",
      loudnessTargetLufs: -14,
      safeZonePct: 0.18,
    });
    const next = useComposition.getState().comp!;
    expect(next.exportPresets).toHaveLength(1);
    expect(next.exportPresets[0].id).toBe("tiktok-9-16");
  });

  it("infers aspect from width/height (1080x1920 → 9:16)", () => {
    const comp = makeCompositionWithClips([]);
    useComposition.setState({ comp });
    useComposition.getState().applyPlatformPreset({
      id: "x",
      label: "x",
      platform: "custom",
      width: 1080,
      height: 1920,
      fps: 30,
      videoBitrate: 8000,
      audioBitrate: 192,
      codec: "h264",
      container: "mp4",
      loudnessTargetLufs: -14,
      safeZonePct: 0.05,
    });
    expect(useComposition.getState().comp!.aspect).toBe("9:16");
  });

  // ADR-009 (S17 consistency fix) — applying a platform preset changes the
  // canvas dimensions exactly like the aspect switch, so it must run the SAME
  // clip-adaptation math (via the shared ops.rescaleCompositionForResize) and
  // proportionally rescale a clip's absolute pixel offset — otherwise a clip
  // nudged off-centre drifts off the resized canvas. This was the divergence:
  // applyPlatformPreset used to write width/height inline and leave clips
  // un-adapted while setAspectRatio adapted them.
  it("rescales clip pixel offsets when the preset resizes the canvas (converged with setAspectRatio)", () => {
    // Start 9:16 (1080×1920) with a video clip nudged 200px right / 400px down.
    const clip = makeVideoClip({
      id: "vp",
      transforms: { scale: 1, x: 200, y: 400, rotation: 0 },
    });
    const comp = makeCompositionWithClips([clip]);
    expect(comp.width).toBe(1080);
    expect(comp.height).toBe(1920);
    useComposition.setState({ comp });
    // Apply a 16:9 (1920×1080) preset: sx = 1920/1080, sy = 1080/1920.
    useComposition.getState().applyPlatformPreset({
      id: "yt-16-9",
      label: "YouTube 16:9",
      platform: "youtube-long",
      width: 1920,
      height: 1080,
      fps: 30,
      videoBitrate: 12000,
      audioBitrate: 192,
      codec: "h264",
      container: "mp4",
      loudnessTargetLufs: -14,
      safeZonePct: 0.05,
    });
    const next = useComposition.getState().comp!;
    expect(next.width).toBe(1920);
    expect(next.height).toBe(1080);
    expect(next.aspect).toBe("16:9");
    const t = (next.tracks[0].clips[0] as {
      transforms: { x: number; y: number };
    }).transforms;
    expect(t.x).toBeCloseTo(200 * (1920 / 1080), 4);
    expect(t.y).toBeCloseTo(400 * (1080 / 1920), 4);
  });

  it("keeps a centred (0,0) clip centred and still applies preset dims/fps", () => {
    const clip = makeVideoClip({
      id: "vc",
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    });
    const comp = makeCompositionWithClips([clip]);
    useComposition.setState({ comp });
    useComposition.getState().applyPlatformPreset({
      id: "ttk",
      label: "TikTok",
      platform: "tiktok",
      width: 1080,
      height: 1920,
      fps: 30,
      videoBitrate: 8000,
      audioBitrate: 192,
      codec: "h264",
      container: "mp4",
      loudnessTargetLufs: -14,
      safeZonePct: 0.18,
    });
    const next = useComposition.getState().comp!;
    const t = (next.tracks[0].clips[0] as {
      transforms: { x: number; y: number };
    }).transforms;
    expect(t.x).toBe(0);
    expect(t.y).toBe(0);
    expect(next.exportPresets[0].id).toBe("ttk");
    expect(next.fps).toBe(30);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";
import {
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
});

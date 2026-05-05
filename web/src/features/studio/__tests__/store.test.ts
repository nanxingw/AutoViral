import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";
import {
  makeCompositionWithClips,
  makeVideoClip,
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

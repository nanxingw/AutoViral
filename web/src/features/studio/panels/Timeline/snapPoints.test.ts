import { describe, it, expect } from "vitest";
import { collectSnapPoints, snapToNearest, snapDraggedStartToPoints } from "@autoviral/timeline";
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

  it("skips negative or non-finite playhead", () => {
    const points = collectSnapPoints(null, new Set(), -1);
    expect(points.map((p) => p.time)).toEqual([0]);
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
  it("does not snap when no point is strictly closer than the threshold (equidistant ties miss)", () => {
    // 2 is equidistant from 1 and 3 (delta = 1). Pneuma uses `d < bestDelta`
    // with bestDelta initialised to threshold, so a delta exactly equal to
    // threshold never wins. This is the documented stability behaviour.
    const ps = [{ time: 1, label: "a" }, { time: 3, label: "b" }];
    expect(snapToNearest(2, ps, 1)).toEqual({ time: 2, snappedTo: null });
  });
  it("breaks ties by picking the first match (deterministic)", () => {
    // Both deltas are 1; threshold 1.5 → first iter 1 < 1.5 wins.
    // Second iter: 1 < 1 is false, so the first point wins.
    const ps = [{ time: 1, label: "a" }, { time: 3, label: "b" }];
    expect(snapToNearest(2, ps, 1.5)).toEqual({ time: 1, snappedTo: 1 });
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
  it("prefers start snap over end snap when both match (start-priority via insertion order)", () => {
    // duration 5, candidate 0 → start 0 (snap to 0), end 5 (also snap to 5).
    // Pneuma walks points in order; start-snap to 0 sets bestDelta=0, then
    // end-snap to 5 has delta 0 which is not < 0, so start-snap wins.
    const r = snapDraggedStartToPoints(0, 5, points, 0.06);
    expect(r.start).toBe(0);
    expect(r.snapTime).toBe(0);
  });
  it("returns candidate unchanged outside threshold", () => {
    expect(snapDraggedStartToPoints(7.5, 1, points, 0.06)).toEqual({ start: 7.5, snapTime: null });
  });
  it("clamps candidate start to 0 (no negative offsets allowed)", () => {
    // Pneuma clamps start = Math.max(0, candidateStart); duration 1 means
    // end=-0.5+1=0.5 (no end-snap close). But the start gets clamped to 0
    // before the loop, so start-snap to 0 fires (delta=0).
    const r = snapDraggedStartToPoints(-0.5, 1, points, 0.06);
    expect(r.start).toBe(0);
    expect(r.snapTime).toBe(0);
  });
});

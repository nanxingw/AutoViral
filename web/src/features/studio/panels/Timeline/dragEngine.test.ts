// Tests for dragEngine.ts — ports pneuma's
// .cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/__tests__/dragEngine.test.ts
// (adapted: pneuma's clip.startTime/clip.duration → AutoViral trackOffset + clipDuration(c))
import { describe, it, expect } from "vitest";
import { computeRipplePreview, snapDraggedStart } from "@autoviral/timeline";
import { makeVideoClip } from "../../../../test/composition-fixtures";

describe("computeRipplePreview", () => {
  it("pins the dragged clip at the requested position", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 2 });
    const p = computeRipplePreview([a, b], "a", 1);
    expect(p.get("a")).toBeCloseTo(1);
  });

  it("pushes an overlapped neighbor forward by the dragged clip's tail", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 1, in: 0, out: 2 });
    // b originally at 1 overlaps dragged end (0+2=2), so push b to 2
    const p = computeRipplePreview([a, b], "a", 0);
    expect(p.get("b")).toBeCloseTo(2);
  });

  it("does not move non-overlapping neighbors", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 2 });
    const p = computeRipplePreview([a, b], "a", 0);
    expect(p.get("b")).toBeCloseTo(5);
  });

  it("ripples through a chain when multiple overlaps occur", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 1, in: 0, out: 2 });
    const c = makeVideoClip({ id: "c", trackOffset: 2, in: 0, out: 2 });
    const p = computeRipplePreview([a, b, c], "a", 0);
    expect(p.get("a")).toBeCloseTo(0);
    expect(p.get("b")).toBeCloseTo(2);
    expect(p.get("c")).toBeCloseTo(4);
  });

  it("returns empty map when draggedClipId is unknown", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const p = computeRipplePreview([a], "missing", 5);
    expect(p.size).toBe(0);
  });

  it("cascades a single overlap: dragged clip lands inside b → b shifts right", () => {
    // a [0..2], b [3..6] (duration 3). Drag a to start=2.5 (overlap of 0.5s with b).
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 3, in: 0, out: 3 });
    const p = computeRipplePreview([a, b], "a", 2.5);
    expect(p.get("a")).toBeCloseTo(2.5);
    // a's new end = 4.5; b must start at 4.5 (no overlap)
    expect(p.get("b")).toBeCloseTo(4.5);
  });
});

describe("snapDraggedStart", () => {
  it("snaps to neighbor start when within threshold", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 3 });
    const r = snapDraggedStart([a, b], "a", 4.9, 0.2);
    expect(r.start).toBeCloseTo(5);
    expect(r.snapTime).toBeCloseTo(5);
  });

  it("snaps dragged end to neighbor start (subtracting duration)", () => {
    // dragged duration 2, want newEnd ≈ 5 → newStart ≈ 3
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 3 });
    const r = snapDraggedStart([a, b], "a", 3.05, 0.2);
    expect(r.start).toBeCloseTo(3);
    expect(r.snapTime).toBeCloseTo(5);
  });

  it("snaps to zero", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 3 });
    const r = snapDraggedStart([a, b], "a", 0.05, 0.2);
    expect(r.start).toBeCloseTo(0);
    expect(r.snapTime).toBeCloseTo(0);
  });

  it("returns candidate unchanged when nothing is in range", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 3 });
    const r = snapDraggedStart([a, b], "a", 12, 0.2);
    expect(r.start).toBeCloseTo(12);
    expect(r.snapTime).toBeNull();
  });

  it("clamps negative drag to zero without reporting a snap", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 3 });
    const r = snapDraggedStart([a, b], "a", -1, 0.01);
    expect(r.start).toBeCloseTo(0);
  });

  it("does not snap to the dragged clip's own edges", () => {
    // Candidate near a's own start=0 — only "timeline 0" point is left.
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const r = snapDraggedStart([a], "a", 0.03, 0.06);
    expect(r.start).toBeCloseTo(0);
    expect(r.snapTime).toBeCloseTo(0);
  });
});

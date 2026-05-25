import { describe, it, expect } from "vitest";
import type { Keyframe } from "./composition.js";
import {
  interpolateProperty,
  addOrReplaceKeyframe,
  splitKeyframesAtLocal,
} from "./keyframes.js";

describe("interpolateProperty", () => {
  it("returns null when no keyframe exists for the requested property", () => {
    expect(interpolateProperty(undefined, "scale", 0)).toBe(null);
    expect(interpolateProperty([], "scale", 0)).toBe(null);
    const kfs: Keyframe[] = [
      { property: "x", time: 0, value: 0, easing: "linear" },
      { property: "x", time: 1, value: 100, easing: "linear" },
    ];
    expect(interpolateProperty(kfs, "scale", 0)).toBe(null);
  });

  it("returns the keyframe value exactly when t equals a keyframe time", () => {
    const kfs: Keyframe[] = [
      { property: "scale", time: 0, value: 1, easing: "linear" },
      { property: "scale", time: 2, value: 2, easing: "linear" },
    ];
    expect(interpolateProperty(kfs, "scale", 0)).toBe(1);
    expect(interpolateProperty(kfs, "scale", 2)).toBe(2);
  });

  it("linearly interpolates between two adjacent keyframes", () => {
    const kfs: Keyframe[] = [
      { property: "scale", time: 0, value: 1, easing: "linear" },
      { property: "scale", time: 2, value: 2, easing: "linear" },
    ];
    expect(interpolateProperty(kfs, "scale", 1)).toBeCloseTo(1.5, 6);
    expect(interpolateProperty(kfs, "scale", 0.5)).toBeCloseTo(1.25, 6);
  });

  it("picks the right segment when there are 3+ keyframes for the same property", () => {
    const kfs: Keyframe[] = [
      { property: "x", time: 0, value: 0, easing: "linear" },
      { property: "x", time: 1, value: 100, easing: "linear" },
      { property: "x", time: 3, value: -100, easing: "linear" },
    ];
    // Inside segment 1 (t ∈ [0,1]): linear from 0→100
    expect(interpolateProperty(kfs, "x", 0.5)).toBeCloseTo(50, 6);
    // Inside segment 2 (t ∈ [1,3]): linear from 100→-100, midpoint at t=2 is 0
    expect(interpolateProperty(kfs, "x", 2)).toBeCloseTo(0, 6);
    expect(interpolateProperty(kfs, "x", 1.5)).toBeCloseTo(50, 6);
  });

  it("clamps to the first keyframe value when t is before all keyframes (D3)", () => {
    const kfs: Keyframe[] = [
      { property: "scale", time: 1, value: 1, easing: "linear" },
      { property: "scale", time: 2, value: 2, easing: "linear" },
    ];
    expect(interpolateProperty(kfs, "scale", 0)).toBe(1);
    expect(interpolateProperty(kfs, "scale", -5)).toBe(1);
  });

  it("clamps to the last keyframe value when t is after all keyframes (D3)", () => {
    const kfs: Keyframe[] = [
      { property: "scale", time: 0, value: 1, easing: "linear" },
      { property: "scale", time: 2, value: 2, easing: "linear" },
    ];
    expect(interpolateProperty(kfs, "scale", 3)).toBe(2);
    expect(interpolateProperty(kfs, "scale", 999)).toBe(2);
  });

  it("applies easeIn — value at midpoint is below linear midpoint", () => {
    // easeIn = bezier(0.42, 0, 1, 1) — slow start, fast end. Midpoint y < 0.5.
    const kfs: Keyframe[] = [
      { property: "scale", time: 0, value: 0, easing: "easeIn" },
      { property: "scale", time: 1, value: 1, easing: "easeIn" },
    ];
    const v = interpolateProperty(kfs, "scale", 0.5)!;
    expect(v).toBeLessThan(0.5);
    expect(v).toBeGreaterThan(0.15);
  });

  it("applies easeOut — value at midpoint is above linear midpoint", () => {
    // easeOut = bezier(0, 0, 0.58, 1) — fast start, slow end. Midpoint y > 0.5.
    const kfs: Keyframe[] = [
      { property: "scale", time: 0, value: 0, easing: "easeOut" },
      { property: "scale", time: 1, value: 1, easing: "easeOut" },
    ];
    const v = interpolateProperty(kfs, "scale", 0.5)!;
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(0.85);
  });

  it("applies easeInOut — symmetric around midpoint", () => {
    // easeInOut = bezier(0.42, 0, 0.58, 1). Midpoint y === 0.5 by symmetry.
    const kfs: Keyframe[] = [
      { property: "scale", time: 0, value: 0, easing: "easeInOut" },
      { property: "scale", time: 1, value: 1, easing: "easeInOut" },
    ];
    expect(interpolateProperty(kfs, "scale", 0.5)).toBeCloseTo(0.5, 3);
    const a = interpolateProperty(kfs, "scale", 0.25)!;
    const b = interpolateProperty(kfs, "scale", 0.75)!;
    expect(a + b).toBeCloseTo(1, 2);
  });

  it("ignores keyframes for *other* properties when interpolating one property", () => {
    const kfs: Keyframe[] = [
      { property: "scale", time: 0, value: 1, easing: "linear" },
      { property: "scale", time: 2, value: 2, easing: "linear" },
      { property: "x", time: 0, value: 0, easing: "linear" },
      { property: "x", time: 1, value: 100, easing: "linear" },
    ];
    expect(interpolateProperty(kfs, "scale", 1)).toBeCloseTo(1.5, 6);
    expect(interpolateProperty(kfs, "x", 0.5)).toBeCloseTo(50, 6);
  });
});

describe("addOrReplaceKeyframe", () => {
  it("addOrReplaceKeyframe replaces an existing entry at the same (property, time)", () => {
    const initial: Keyframe[] = [
      { property: "scale", time: 0, value: 1, easing: "linear" },
      { property: "scale", time: 1, value: 2, easing: "linear" },
    ];
    const next: Keyframe = { property: "scale", time: 1, value: 3, easing: "easeOut" };
    const out = addOrReplaceKeyframe(initial, next);
    expect(out.length).toBe(2);
    const replaced = out.find((k) => k.time === 1)!;
    expect(replaced.value).toBe(3);
    expect(replaced.easing).toBe("easeOut");
    // Within EPSILON should also dedupe:
    const out2 = addOrReplaceKeyframe(initial, { ...next, time: 1 + 5e-5 });
    expect(out2.length).toBe(2);
  });

  it("addOrReplaceKeyframe inserts a new entry sorted by time within its property group", () => {
    const initial: Keyframe[] = [
      { property: "scale", time: 0, value: 1, easing: "linear" },
      { property: "scale", time: 2, value: 3, easing: "linear" },
    ];
    const out = addOrReplaceKeyframe(initial, {
      property: "scale",
      time: 1,
      value: 2,
      easing: "linear",
    });
    expect(out.length).toBe(3);
    const scaleEntries = out.filter((k) => k.property === "scale");
    expect(scaleEntries.map((k) => k.time)).toEqual([0, 1, 2]);
  });
});

// #46 — splitting an animated clip used to copy the whole keyframes array into
// both halves with no partition / rebase, corrupting both. These tests pin the
// partition, the rebase, and (the real contract) value continuity across the
// cut: each half's curve must match the original at the corresponding time.
describe("splitKeyframesAtLocal", () => {
  const kf = (
    property: Keyframe["property"],
    time: number,
    value: number,
    easing: Keyframe["easing"] = "linear",
  ): Keyframe => ({ property, time, value, easing });

  it("returns empty halves for undefined / empty input (text clips)", () => {
    expect(splitKeyframesAtLocal(undefined, 5)).toEqual({ a: [], b: [] });
    expect(splitKeyframesAtLocal([], 5)).toEqual({ a: [], b: [] });
  });

  it("partitions by the split point and rebases child B to clip-local 0 (the #46 repro)", () => {
    // scale @ t=2 (1.2) and t=12 (1.5); split at clip-local 7.
    const kfs = [kf("scale", 2, 1.2), kf("scale", 12, 1.5)];
    const { a, b } = splitKeyframesAtLocal(kfs, 7);

    // child A: original t=2 kept, plus a boundary at the split (t=7). No t=12.
    expect(a.map((k) => k.time)).toEqual([2, 7]);
    // child B: boundary at 0, plus t=12 rebased to 12-7=5. No t=2.
    expect(b.map((k) => k.time)).toEqual([0, 5]);
    // the late keyframe is NOT in child A and the early one is NOT in child B.
    expect(a.some((k) => k.time === 12)).toBe(false);
    expect(b.some((k) => k.value === 1.2 && k.time === 2)).toBe(false);
  });

  it("preserves value continuity at the cut (linear → exact reconstruction)", () => {
    const kfs = [kf("scale", 2, 1.2), kf("scale", 12, 1.5)];
    const S = 7;
    const vAtSplit = interpolateProperty(kfs, "scale", S)!; // 1.2 + 0.3*0.5 = 1.35
    const { a, b } = splitKeyframesAtLocal(kfs, S);

    // child A's value at its end (split) == child B's value at 0 == original@split.
    expect(interpolateProperty(a, "scale", S)).toBeCloseTo(vAtSplit, 6);
    expect(interpolateProperty(b, "scale", 0)).toBeCloseTo(vAtSplit, 6);

    // For linear easing the halves reproduce the original curve EXACTLY:
    // sample several clip-local times and compare to the original timeline value.
    for (const localA of [0, 1, 2, 4, 6.9]) {
      expect(interpolateProperty(a, "scale", localA)).toBeCloseTo(
        interpolateProperty(kfs, "scale", localA)!,
        6,
      );
    }
    for (const localB of [0, 1, 3, 5, 7.5]) {
      expect(interpolateProperty(b, "scale", localB)).toBeCloseTo(
        interpolateProperty(kfs, "scale", localB + S)!,
        6,
      );
    }
  });

  it("handles multiple properties independently", () => {
    const kfs = [
      kf("scale", 0, 1),
      kf("scale", 10, 2),
      kf("opacity", 4, 0),
      kf("opacity", 6, 1),
    ];
    const { a, b } = splitKeyframesAtLocal(kfs, 5);
    // both properties get a split boundary; rebase is per-property.
    const aScale = a.filter((k) => k.property === "scale");
    const bScale = b.filter((k) => k.property === "scale");
    const aOpacity = a.filter((k) => k.property === "opacity");
    const bOpacity = b.filter((k) => k.property === "opacity");
    expect(aScale.map((k) => k.time)).toEqual([0, 5]);
    expect(bScale.map((k) => k.time)).toEqual([0, 5]); // boundary@0 + t=10 rebased to 5
    expect(aOpacity.map((k) => k.time)).toEqual([4, 5]); // t=4 kept + boundary
    expect(bOpacity.map((k) => k.time)).toEqual([0, 1]); // boundary + t=6 rebased to 1
  });

  it("a property with all keyframes before the split pins child B's held value", () => {
    // scale ramps 1→2 over [0,4]; split at 8 (past all keyframes).
    const kfs = [kf("scale", 0, 1), kf("scale", 4, 2)];
    const { a, b } = splitKeyframesAtLocal(kfs, 8);
    // child A keeps both + boundary; child B gets a single boundary holding 2
    // (the clamped value), NOT a fallback to the clip's static transform.
    expect(interpolateProperty(a, "scale", 4)).toBeCloseTo(2, 6);
    expect(b).toHaveLength(1);
    expect(b[0].time).toBe(0);
    expect(b[0].value).toBeCloseTo(2, 6);
  });

  it("inherits the split segment's easing onto child B's leading boundary", () => {
    const kfs = [kf("scale", 0, 1, "easeInOut"), kf("scale", 10, 2, "easeInOut")];
    const { b } = splitKeyframesAtLocal(kfs, 5);
    // child B's time:0 boundary controls the leading sub-segment; it should
    // carry the original segment's easing, not a flattened linear.
    expect(b[0].easing).toBe("easeInOut");
  });
});

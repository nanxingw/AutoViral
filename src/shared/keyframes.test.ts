import { describe, it, expect } from "vitest";
import type { Keyframe } from "./composition.js";
import { interpolateProperty, addOrReplaceKeyframe } from "./keyframes.js";

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

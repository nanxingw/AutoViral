import { describe, it, expect } from "vitest";
import { KeyframeSchema, KeyframeEasingSchema } from "./composition.js";

// PRD-0014 S12 — bezier easing data model. `KeyframeEasingSchema` widens from a
// 4-value discrete enum to `enum ∪ {type:"cubic-bezier", p:[x1,y1,x2,y2]}`. The
// x control points must stay in [0,1] (a timing function must be a function of
// x); y is unbounded so bounce / anticipation curves are expressible. The 4
// discrete easings keep their exact old behavior (regression lock), and a
// legacy keyframe with no `easing` field still defaults to "linear".

describe("KeyframeEasingSchema (cubic-bezier widening)", () => {
  it("accepts the 4 discrete enum easings unchanged (no drift)", () => {
    for (const e of ["linear", "easeIn", "easeOut", "easeInOut"] as const) {
      expect(KeyframeEasingSchema.parse(e)).toBe(e);
    }
  });

  it("accepts a cubic-bezier easing with x control points inside [0,1]", () => {
    const e = { type: "cubic-bezier", p: [0.4, 0, 0.2, 1] };
    expect(KeyframeEasingSchema.parse(e)).toEqual(e);
  });

  it("allows y control points to overshoot [0,1] (bounce / anticipation)", () => {
    const e = { type: "cubic-bezier", p: [0.5, -0.5, 0.5, 1.5] };
    expect(KeyframeEasingSchema.parse(e)).toEqual(e);
  });

  it("rejects x1 outside [0,1]", () => {
    expect(() =>
      KeyframeEasingSchema.parse({ type: "cubic-bezier", p: [1.4, 0, 0.2, 1] }),
    ).toThrow();
  });

  it("rejects x2 outside [0,1]", () => {
    expect(() =>
      KeyframeEasingSchema.parse({ type: "cubic-bezier", p: [0.4, 0, -0.2, 1] }),
    ).toThrow();
  });

  it("rejects a wrong-length p tuple", () => {
    expect(() =>
      KeyframeEasingSchema.parse({ type: "cubic-bezier", p: [0.4, 0, 0.2] }),
    ).toThrow();
  });

  it("rejects an unknown discrete easing name", () => {
    expect(() => KeyframeEasingSchema.parse("wobble")).toThrow();
  });

  it("rejects an object with a wrong type discriminator", () => {
    expect(() =>
      KeyframeEasingSchema.parse({ type: "spring", p: [0.4, 0, 0.2, 1] }),
    ).toThrow();
  });
});

describe("KeyframeSchema back-compat with the widened easing", () => {
  it("defaults a keyframe with no easing to linear (存量 yaml)", () => {
    const kf = KeyframeSchema.parse({ property: "scale", time: 1, value: 2 });
    expect(kf.easing).toBe("linear");
  });

  it("round-trips a keyframe carrying a cubic-bezier easing", () => {
    const kf = KeyframeSchema.parse({
      property: "scale",
      time: 1,
      value: 2,
      easing: { type: "cubic-bezier", p: [0.4, 0, 0.2, 1] },
    });
    expect(kf.easing).toEqual({ type: "cubic-bezier", p: [0.4, 0, 0.2, 1] });
  });

  it("still round-trips a keyframe carrying a discrete easing", () => {
    const kf = KeyframeSchema.parse({
      property: "opacity",
      time: 0.5,
      value: 1,
      easing: "easeInOut",
    });
    expect(kf.easing).toBe("easeInOut");
  });
});

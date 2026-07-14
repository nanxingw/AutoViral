import { describe, it, expect } from "vitest";
import { snapToFrame } from "./frame.js";
import { CompositionOpError } from "./composition/ops/errors.js";

// PRD-0014 S15 — `snapToFrame(sec, fps)`: the SINGLE shared frame-quantiser the
// ops layer routes every offset/in/out/durationSec write through so agent-CLI
// and human-UI edits both land on whole-frame boundaries (kills the sub-frame
// drift that produced the #026/#027 export jitter). Also the one helper the S4
// speed-ramp segment boundaries and the S8 reframe snap clamp are consolidated
// onto (no third copy of `Math.round(sec*fps)/fps`).
describe("snapToFrame (S15)", () => {
  it("rounds a sub-frame time to the nearest frame boundary (30fps)", () => {
    // 0.034s @30fps = 1.02 frames → rounds to frame 1 = 1/30 = 0.0333…s
    expect(snapToFrame(0.034, 30)).toBeCloseTo(1 / 30, 9);
  });

  it("rounds half-up to the nearest frame", () => {
    // 0.05s @30fps = 1.5 frames → rounds up to frame 2 = 2/30 = 0.0667s
    expect(snapToFrame(0.05, 30)).toBeCloseTo(2 / 30, 9);
  });

  it("is idempotent — snapping an already-frame-aligned value is a no-op", () => {
    const v = 3 / 30;
    expect(snapToFrame(v, 30)).toBeCloseTo(v, 12);
    expect(snapToFrame(snapToFrame(v, 30), 30)).toBeCloseTo(v, 12);
  });

  it("respects the composition fps (24 vs 60 land on different grids)", () => {
    // 1.23456s @24fps = 29.629 frames → frame 30 = 30/24 = 1.25s
    expect(snapToFrame(1.23456, 24)).toBeCloseTo(30 / 24, 9);
    // 1.23456s @60fps = 74.07 frames → frame 74 = 74/60 = 1.2333…s
    expect(snapToFrame(1.23456, 60)).toBeCloseTo(74 / 60, 9);
  });

  it("keeps every result on a whole-frame boundary", () => {
    for (const sec of [0, 0.001, 0.5, 1.017, 2.06, 9.99]) {
      const snapped = snapToFrame(sec, 30);
      expect(Math.abs(snapped * 30 - Math.round(snapped * 30))).toBeLessThan(1e-6);
    }
  });

  it("rejects a negative time (code 4)", () => {
    expect(() => snapToFrame(-0.5, 30)).toThrow(CompositionOpError);
    try {
      snapToFrame(-0.5, 30);
    } catch (err) {
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("rejects a non-finite time (NaN / Infinity, code 4)", () => {
    for (const bad of [NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => snapToFrame(bad, 30)).toThrow(CompositionOpError);
    }
  });

  it("rejects a non-positive / non-finite fps (code 4)", () => {
    for (const bad of [0, -30, NaN, Number.POSITIVE_INFINITY]) {
      expect(() => snapToFrame(1, bad)).toThrow(CompositionOpError);
    }
  });
});

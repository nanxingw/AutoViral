import { describe, it, expect } from "vitest";
import { aggregateProgress } from "../worker.js";

// R46 — direct unit coverage for the weighted budget. The renderer
// emits onP(stage, pct) where pct is 0..1 *within* the stage. The
// worker translates that to a global 0..1 visible to the user. With
// equal-split (R43) every stage advanced by 0.2; with weighted budgets
// (R46) render alone advances 0.75 because that's where the wall-clock
// goes.

describe("aggregateProgress — weighted budgets", () => {
  it("render at 0% → 0", () => {
    expect(aggregateProgress("render", 0)).toBeCloseTo(0, 6);
  });

  it("render at 100% → 0.75 (full render budget consumed)", () => {
    expect(aggregateProgress("render", 1)).toBeCloseTo(0.75, 6);
  });

  it("render at 50% → 0.375 (half of render's 0.75 slice)", () => {
    expect(aggregateProgress("render", 0.5)).toBeCloseTo(0.375, 6);
  });

  it("duck at 0% → 0.75 (cumulative from render done)", () => {
    expect(aggregateProgress("duck", 0)).toBeCloseTo(0.75, 6);
  });

  it("duck at 100% → 0.80 (0.75 + 0.05)", () => {
    expect(aggregateProgress("duck", 1)).toBeCloseTo(0.8, 6);
  });

  it("loudnorm at 0% → 0.80", () => {
    expect(aggregateProgress("loudnorm", 0)).toBeCloseTo(0.8, 6);
  });

  it("burn at 0% → 0.85", () => {
    expect(aggregateProgress("burn", 0)).toBeCloseTo(0.85, 6);
  });

  it("encode at 0% → 0.90", () => {
    expect(aggregateProgress("encode", 0)).toBeCloseTo(0.9, 6);
  });

  it("encode at 100% → 1.0 (full pipeline complete)", () => {
    expect(aggregateProgress("encode", 1)).toBeCloseTo(1, 6);
  });

  it("clamps pct < 0 to 0", () => {
    expect(aggregateProgress("render", -0.5)).toBeCloseTo(0, 6);
  });

  it("clamps pct > 1 to 1", () => {
    expect(aggregateProgress("render", 2)).toBeCloseTo(0.75, 6);
  });

  it("monotonic across stages — every transition strictly advances", () => {
    // Walk the full pipeline, asserting each (stage, 0%) is >= the
    // previous (prevStage, 100%). This is what users care about: no
    // visible regressions in the bar.
    const order: Array<["render" | "duck" | "loudnorm" | "burn" | "encode", number]> = [
      ["render", 0],
      ["render", 1],
      ["duck", 0],
      ["duck", 1],
      ["loudnorm", 0],
      ["loudnorm", 1],
      ["burn", 0],
      ["burn", 1],
      ["encode", 0],
      ["encode", 1],
    ];
    let prev = -1;
    for (const [stage, pct] of order) {
      const v = aggregateProgress(stage, pct);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

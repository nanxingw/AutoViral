// Phase 8.3.E — chainAtempo decomposition unit tests.
//
// `atempo`'s per-instance range is [0.5, 2.0]. Our public speed range is
// [0.1, 4.0] (D10), so chainAtempo decomposes into a comma-joined chain
// whose product equals the requested speed within 1e-4. These tests
// exercise the math independently of spawn().

import { describe, it, expect } from "vitest";
import { chainAtempo } from "./speed-ramp-ffmpeg.js";

function productOfAtempos(expr: string): number {
  return expr
    .split(",")
    .map((part) => Number(part.replace(/^atempo=/, "")))
    .reduce((a, b) => a * b, 1);
}

describe("chainAtempo", () => {
  it("speed=1.0 returns the no-op atempo=1.0", () => {
    expect(chainAtempo(1.0)).toBe("atempo=1.0");
  });

  it("speed=2.0 returns a single atempo=2.0000", () => {
    const expr = chainAtempo(2.0);
    expect(expr).toBe("atempo=2.0000");
    expect(productOfAtempos(expr)).toBeCloseTo(2.0, 4);
  });

  it("speed=4.0 chains two atempo=2.0 instances (2.0 * 2.0 = 4.0)", () => {
    const expr = chainAtempo(4.0);
    expect(expr).toBe("atempo=2.0000,atempo=2.0000");
    expect(productOfAtempos(expr)).toBeCloseTo(4.0, 4);
  });

  it("speed=0.1 chains 0.5 * 0.5 * 0.4 = 0.1 (3-stage)", () => {
    const expr = chainAtempo(0.1);
    expect(expr).toBe("atempo=0.5000,atempo=0.5000,atempo=0.4000");
    expect(productOfAtempos(expr)).toBeCloseTo(0.1, 4);
  });

  it("speed=0.5 returns a single atempo=0.5000", () => {
    const expr = chainAtempo(0.5);
    expect(expr).toBe("atempo=0.5000");
    expect(productOfAtempos(expr)).toBeCloseTo(0.5, 4);
  });

  it("speed=3.0 decomposes into 2.0 * 1.5", () => {
    const expr = chainAtempo(3.0);
    expect(productOfAtempos(expr)).toBeCloseTo(3.0, 4);
    // First step is 2.0, then the remainder 1.5
    expect(expr.split(",")[0]).toBe("atempo=2.0000");
  });
});

import { describe, expect, it } from "vitest";
import type { Keyframe } from "./composition.js";
import { SPEED_MAX, SPEED_MIN, VideoClipSchema } from "./composition.js";
import {
  clampSpeed,
  computeVideoSpeedForFrame,
  effectiveClipDuration,
  isStaticSpeed,
} from "./speed-ramp.js";

// Phase 8.3.A — pure helpers for speed-ramp / time-remap. Reuses 8.2's
// interpolateProperty under the hood; tests verify the (D3) 1.0 fallback,
// (D4) [0.1, 4.0] clamp, (D7) duration math, and (D9) integration direction.

describe("clampSpeed", () => {
  it("clamps below 0.1 → 0.1", () => {
    expect(clampSpeed(0.05)).toBe(SPEED_MIN);
    expect(clampSpeed(0)).toBe(SPEED_MIN);
    expect(clampSpeed(-1)).toBe(SPEED_MIN);
  });

  it("clamps above 4.0 → 4.0", () => {
    expect(clampSpeed(4.5)).toBe(SPEED_MAX);
    expect(clampSpeed(100)).toBe(SPEED_MAX);
  });

  it("passes through values in range and falls back to 1.0 for non-finite input", () => {
    expect(clampSpeed(1)).toBe(1);
    expect(clampSpeed(0.5)).toBe(0.5);
    expect(clampSpeed(2.0)).toBe(2.0);
    // Non-finite → defensive 1.0 (NaN/Infinity guard).
    expect(clampSpeed(NaN)).toBe(1.0);
    expect(clampSpeed(Infinity)).toBe(1.0);
    expect(clampSpeed(-Infinity)).toBe(1.0);
  });
});

describe("computeVideoSpeedForFrame", () => {
  it("returns 1.0 when no keyframes (D3)", () => {
    expect(computeVideoSpeedForFrame({}, 0, 30)).toBe(1.0);
    expect(computeVideoSpeedForFrame({ keyframes: [] }, 30, 30)).toBe(1.0);
  });

  it("returns 1.0 when keyframes have no speed property (D3)", () => {
    const kfs: Keyframe[] = [
      { property: "scale", time: 0, value: 1, easing: "linear" },
      { property: "scale", time: 1, value: 2, easing: "linear" },
    ];
    expect(computeVideoSpeedForFrame({ keyframes: kfs }, 30, 30)).toBe(1.0);
  });

  it("returns the static value when speed keyframes are constant", () => {
    const kfs: Keyframe[] = [
      { property: "speed", time: 0, value: 2.0, easing: "linear" },
      { property: "speed", time: 4, value: 2.0, easing: "linear" },
    ];
    expect(computeVideoSpeedForFrame({ keyframes: kfs }, 60, 30)).toBe(2.0);
  });

  it("interpolates between two speed keyframes", () => {
    const kfs: Keyframe[] = [
      { property: "speed", time: 0, value: 1.0, easing: "linear" },
      { property: "speed", time: 2, value: 2.0, easing: "linear" },
    ];
    // At t=1s (frame 30 @ 30fps), linear midpoint = 1.5
    expect(computeVideoSpeedForFrame({ keyframes: kfs }, 30, 30)).toBeCloseTo(
      1.5,
      6,
    );
  });

  it("applies the [0.1, 4.0] clamp on output (defensive)", () => {
    // Schema rejects values outside [0.1, 4.0] at parse time, but the runtime
    // helper must defend against malformed input from older builds.
    const kfs: Keyframe[] = [
      { property: "speed", time: 0, value: 99, easing: "linear" },
      { property: "speed", time: 2, value: 99, easing: "linear" },
    ];
    expect(computeVideoSpeedForFrame({ keyframes: kfs }, 30, 30)).toBe(
      SPEED_MAX,
    );
  });
});

describe("isStaticSpeed", () => {
  it("returns null when no speed keyframes", () => {
    expect(isStaticSpeed({})).toBeNull();
    expect(isStaticSpeed({ keyframes: [] })).toBeNull();
    expect(
      isStaticSpeed({
        keyframes: [
          { property: "scale", time: 0, value: 1, easing: "linear" },
        ],
      }),
    ).toBeNull();
  });

  it("returns the value when all speed keyframes match within EPSILON", () => {
    const kfs: Keyframe[] = [
      { property: "speed", time: 0, value: 2.0, easing: "linear" },
      { property: "speed", time: 4, value: 2.0 + 5e-5, easing: "linear" },
    ];
    expect(isStaticSpeed({ keyframes: kfs })).toBeCloseTo(2.0, 4);
  });

  it("returns null when speed keyframes disagree", () => {
    const kfs: Keyframe[] = [
      { property: "speed", time: 0, value: 1.0, easing: "linear" },
      { property: "speed", time: 4, value: 2.0, easing: "linear" },
    ];
    expect(isStaticSpeed({ keyframes: kfs })).toBeNull();
  });
});

describe("effectiveClipDuration", () => {
  it("returns (out - in) when no speed keyframes (D3)", () => {
    expect(effectiveClipDuration({ in: 0, out: 4 })).toBe(4);
    expect(effectiveClipDuration({ in: 1, out: 5, keyframes: [] })).toBe(4);
  });

  it("returns (out - in) / k for static speed=k (D7)", () => {
    const kfs: Keyframe[] = [
      { property: "speed", time: 0, value: 2.0, easing: "linear" },
      { property: "speed", time: 4, value: 2.0, easing: "linear" },
    ];
    expect(
      effectiveClipDuration({ in: 0, out: 4, keyframes: kfs }),
    ).toBeCloseTo(2.0, 4);
    // speed=0.5 → double duration
    const half: Keyframe[] = [
      { property: "speed", time: 0, value: 0.5, easing: "linear" },
      { property: "speed", time: 8, value: 0.5, easing: "linear" },
    ];
    expect(
      effectiveClipDuration({ in: 0, out: 4, keyframes: half }),
    ).toBeCloseTo(8.0, 4);
  });

  it("integrates the curve for variable speed (D7/D9)", () => {
    // Linear ramp from 1.0 → 2.0 over the *full source* (kfs at clip ends).
    // For v(t) = 1 + 0.25t between time 0..4, ∫₀^T v dt = T + 0.125T² = 4
    // → 0.125T² + T - 4 = 0 → T ≈ 2.928 (average speed ≈ 1.366).
    const kfs: Keyframe[] = [
      { property: "speed", time: 0, value: 1.0, easing: "linear" },
      { property: "speed", time: 4, value: 2.0, easing: "linear" },
    ];
    const dur = effectiveClipDuration({ in: 0, out: 4, keyframes: kfs });
    // Closed-form ≈ 2.928. Sampler error ±0.02s.
    expect(dur).toBeGreaterThan(2.85);
    expect(dur).toBeLessThan(3.0);
  });

  it("integrates the curve for a slowdown ramp (avg < 1 → expansion)", () => {
    // Ramp 1.0 → 0.5 over a 4s source, kfs at the clip ends.
    // v(t) = 1 - 0.125t. ∫₀^T = T - 0.0625T² = 4. Solving:
    //   0.0625T² - T + 4 = 0 → T = (1 - √(1 - 1)) / 0.125 = 8 (the only real root).
    // Reality: the curve hits 0.5 at t=4 and remains 0.5 thereafter (clamp).
    // From t=4 onwards we accumulate 0.5*dt per step. After t=4 we've consumed
    // ∫₀^4 v dt = 4 - 1 = 3 source-seconds, leaving 1 to consume at speed 0.5
    // → an extra 2s. Total T ≈ 6.0.
    const kfs: Keyframe[] = [
      { property: "speed", time: 0, value: 1.0, easing: "linear" },
      { property: "speed", time: 4, value: 0.5, easing: "linear" },
    ];
    const dur = effectiveClipDuration({ in: 0, out: 4, keyframes: kfs });
    expect(dur).toBeGreaterThan(5.9);
    expect(dur).toBeLessThan(6.1);
  });
});

describe("VideoClipSchema speed superRefine (D4/D10)", () => {
  const baseClip = {
    id: "v1",
    kind: "video" as const,
    src: "/x.mp4",
    in: 0,
    out: 4,
    trackOffset: 0,
  };

  it("rejects a speed keyframe with value > 4.0", () => {
    expect(() =>
      VideoClipSchema.parse({
        ...baseClip,
        keyframes: [
          { property: "speed", time: 0, value: 5.0, easing: "linear" },
        ],
      }),
    ).toThrow();
  });

  it("rejects a speed keyframe with value < 0.1", () => {
    expect(() =>
      VideoClipSchema.parse({
        ...baseClip,
        keyframes: [
          { property: "speed", time: 0, value: -1, easing: "linear" },
        ],
      }),
    ).toThrow();
  });

  it("accepts a speed keyframe with value 2.0 (in range)", () => {
    const parsed = VideoClipSchema.parse({
      ...baseClip,
      keyframes: [
        { property: "speed", time: 0, value: 2.0, easing: "linear" },
      ],
    });
    expect(parsed.keyframes?.[0].value).toBe(2.0);
  });
});

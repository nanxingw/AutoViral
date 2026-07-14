// Phase 8.3.E — chainAtempo decomposition unit tests.
//
// `atempo`'s per-instance range is [0.5, 2.0]. Our public speed range is
// [0.1, 4.0] (D10), so chainAtempo decomposes into a comma-joined chain
// whose product equals the requested speed within 1e-4. These tests
// exercise the math independently of spawn().

import { describe, it, expect } from "vitest";
import {
  chainAtempo,
  buildSpeedRampFilterArgs,
  speedRampCacheName,
  planSpeedSegments,
  buildVariableSpeedFilterArgs,
  variableSpeedCacheName,
  buildAudioSpeedFilterArgs,
  audioSpeedCacheName,
} from "./speed-ramp-ffmpeg.js";

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

// S3 (PRD-0012) — keyframe interval normalisation. The speed-ramp pre-pass
// re-encodes via -filter_complex + -map (no -c:v/-map copy path), so it also
// needs -g/-keyint_min = fps or a sped-up clip loses the Seedance source's
// ~1s-GOP normalisation and amplifies the backward-jump seek error
// (docs/issues/026).
describe("buildSpeedRampFilterArgs (S3 — argv-level, not just chainAtempo)", () => {
  it("wraps setpts/atempo in -filter_complex with -map [v] -map [a]", () => {
    const args = buildSpeedRampFilterArgs("in.mp4", "out.mp4", 2.0, 30);
    expect(args).toContain("-i");
    expect(args).toContain("in.mp4");
    expect(args).toContain("out.mp4");
    const filterIdx = args.indexOf("-filter_complex");
    expect(filterIdx).toBeGreaterThan(-1);
    expect(args[filterIdx + 1]).toContain("setpts=PTS/2");
    expect(args).toContain("[v]");
    expect(args).toContain("[a]");
  });

  it("argv contains -g and -keyint_min set to the fps", () => {
    const args = buildSpeedRampFilterArgs("in.mp4", "out.mp4", 2.0, 30);
    const gIdx = args.indexOf("-g");
    expect(gIdx).toBeGreaterThan(-1);
    expect(args[gIdx + 1]).toBe("30");
    const keyintIdx = args.indexOf("-keyint_min");
    expect(keyintIdx).toBeGreaterThan(-1);
    expect(args[keyintIdx + 1]).toBe("30");
  });

  it("output path remains the LAST argv element (render-pipeline reads args[args.length-1] as the cache filename)", () => {
    const args = buildSpeedRampFilterArgs("in.mp4", "/work/clip-1-speed-200.mp4", 2.0, 24);
    expect(args[args.length - 1]).toBe("/work/clip-1-speed-200.mp4");
  });
});

// codex review (S3×S6 finding, medium) — the speed-ramp cache filename was
// generated inline (`clip-${id}-speed-${round(speed*100)}.mp4`), keyed ONLY
// on the clip id + speed, never on fps. S3's -g/-keyint_min GOP fix bakes
// comp.fps into this pre-pass's ffmpeg output (buildSpeedRampFilterArgs
// above), but PRD-0011 made fps a user-editable field — so a user who
// changes fps and re-exports the SAME sped-up clip would hit the OLD cache
// (wrong GOP) and silently skip the re-encode. Extracted into a named,
// directly-testable function (mirrors transformsCacheName / timeWarpCacheName)
// with fps folded into the key.
describe("speedRampCacheName (S3×S6 — fps is part of the cache key, not just speed)", () => {
  it("same clip id + speed, DIFFERENT fps → DIFFERENT cache name", () => {
    const at24 = speedRampCacheName("c1", 2.0, 24);
    const at30 = speedRampCacheName("c1", 2.0, 30);
    expect(at24).not.toBe(at30);
  });

  it("same params → same name (cache HIT still works; deterministic)", () => {
    expect(speedRampCacheName("c1", 2.0, 30)).toBe(speedRampCacheName("c1", 2.0, 30));
  });

  it("encodes speed as round(speed*100) and fps verbatim in a stable, greppable name", () => {
    expect(speedRampCacheName("vc_1", 2.0, 30)).toBe("clip-vc_1-speed-200-fps30.mp4");
    expect(speedRampCacheName("vc_1", 0.5, 24)).toBe("clip-vc_1-speed-50-fps24.mp4");
  });
});

// ─── S4 (PRD-0014) — variable-speed export ─────────────────────────────────
// The v1 pre-pass logged a one-time warning for multi-value speed keyframes
// and left the clip untouched → the preview's <OffthreadVideo playbackRate>
// ramp ran but the FINAL EXPORT played back at 1× (the most malignant WYSIWYG
// crack). S4 replaces the warn+fallback with a real segmented setpts/atempo →
// concat pass.

describe("planSpeedSegments (S4 — variable-speed source segmentation)", () => {
  const kf = (time: number, value: number) => ({
    property: "speed" as const,
    time,
    value,
    easing: "linear" as const,
  });

  it("2→1 step curve over a 4s clip → two segments (2×, 1×), total 3s timeline", () => {
    const clip = { in: 0, out: 4, keyframes: [kf(0, 2), kf(2, 1)] };
    const { segments, totalTimelineDuration } = planSpeedSegments(clip, 30);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ srcStart: 0, srcEnd: 2, speed: 2 });
    expect(segments[1]).toMatchObject({ srcStart: 2, srcEnd: 4, speed: 1 });
    // 2s of source @ 2× = 1s timeline; 2s of source @ 1× = 2s timeline.
    expect(segments[0].timelineDuration).toBeCloseTo(1, 5);
    expect(segments[1].timelineDuration).toBeCloseTo(2, 5);
    expect(totalTimelineDuration).toBeCloseTo(3, 5);
  });

  it("frame-aligns segment cut points to the composition fps", () => {
    // keyframe at a sub-frame source time (30.51 frames @ 30fps) snaps to the
    // nearest whole frame (31 → 1.0333s) — no dropped/split frames at joins.
    const clip = { in: 0, out: 4, keyframes: [kf(0, 2), kf(1.017, 1)] };
    const { segments } = planSpeedSegments(clip, 30);
    const boundary = segments[0].srcEnd;
    expect(boundary * 30).toBeCloseTo(Math.round(boundary * 30), 6);
    expect(boundary).toBeCloseTo(31 / 30, 6);
  });

  it("keyframe time is clip-local: respects clip.in when placing source cuts", () => {
    const clip = { in: 1, out: 5, keyframes: [kf(0, 2), kf(2, 1)] };
    const { segments } = planSpeedSegments(clip, 30);
    expect(segments[0]).toMatchObject({ srcStart: 1, srcEnd: 3, speed: 2 });
    expect(segments[1]).toMatchObject({ srcStart: 3, srcEnd: 5, speed: 1 });
  });

  it("three-value curve → three source segments in order", () => {
    const clip = { in: 0, out: 6, keyframes: [kf(0, 2), kf(2, 1), kf(4, 0.5)] };
    const { segments } = planSpeedSegments(clip, 30);
    expect(segments.map((s) => s.speed)).toEqual([2, 1, 0.5]);
    expect(segments.map((s) => s.srcStart)).toEqual([0, 2, 4]);
    expect(segments.map((s) => s.srcEnd)).toEqual([2, 4, 6]);
  });
});

describe("buildVariableSpeedFilterArgs (S4 — per-segment trim/setpts/atempo → concat)", () => {
  const segments = [
    { srcStart: 0, srcEnd: 2, speed: 2, timelineDuration: 1 },
    { srcStart: 2, srcEnd: 4, speed: 1, timelineDuration: 2 },
  ];

  it("emits per-segment trim + setpts + atempo and a concat mapping [v]/[a]", () => {
    const args = buildVariableSpeedFilterArgs("in.mp4", "out.mp4", segments, 30);
    const f = args[args.indexOf("-filter_complex") + 1];
    expect(f).toContain("trim=start=0");
    expect(f).toContain("setpts=(PTS-STARTPTS)/2");
    expect(f).toContain("atrim=start=0");
    expect(f).toContain("atempo=2.0000");
    // 2 segments, one video + one audio each → concat n=2.
    expect(f).toContain("concat=n=2:v=1:a=1[v][a]");
    expect(args).toContain("[v]");
    expect(args).toContain("[a]");
  });

  it("carries the S3 GOP fix (-g/-keyint_min = fps) and output stays last", () => {
    const args = buildVariableSpeedFilterArgs("in.mp4", "out.mp4", segments, 24);
    const gIdx = args.indexOf("-g");
    expect(gIdx).toBeGreaterThan(-1);
    expect(args[gIdx + 1]).toBe("24");
    expect(args[args.indexOf("-keyint_min") + 1]).toBe("24");
    expect(args[args.length - 1]).toBe("out.mp4");
  });
});

describe("variableSpeedCacheName (S4 — cache key covers the speed CURVE content)", () => {
  const kf = (time: number, value: number) => ({
    property: "speed" as const,
    time,
    value,
    easing: "linear" as const,
  });
  const curveA = [kf(0, 2), kf(2, 1)];
  const curveB = [kf(0, 2), kf(2, 1.5)]; // different value at t=2
  const curveC = [kf(0, 2), kf(3, 1)]; // different time at kf1

  it("a different curve → a different cache name (PRD-0011 cache-triangle discipline)", () => {
    expect(variableSpeedCacheName("c1", curveA, 0, 4, 30)).not.toBe(
      variableSpeedCacheName("c1", curveB, 0, 4, 30),
    );
    expect(variableSpeedCacheName("c1", curveA, 0, 4, 30)).not.toBe(
      variableSpeedCacheName("c1", curveC, 0, 4, 30),
    );
  });

  it("same curve + span + fps → same name (deterministic cache HIT)", () => {
    expect(variableSpeedCacheName("c1", curveA, 0, 4, 30)).toBe(
      variableSpeedCacheName("c1", curveA, 0, 4, 30),
    );
  });

  it("different fps → different name (S3×S6 GOP-in-key discipline)", () => {
    expect(variableSpeedCacheName("c1", curveA, 0, 4, 24)).not.toBe(
      variableSpeedCacheName("c1", curveA, 0, 4, 30),
    );
  });

  it("different clip in/out span → different name", () => {
    expect(variableSpeedCacheName("c1", curveA, 0, 4, 30)).not.toBe(
      variableSpeedCacheName("c1", curveA, 1, 5, 30),
    );
  });

  it("greppable prefix (so the asset library can hide it)", () => {
    expect(variableSpeedCacheName("c1", curveA, 0, 4, 30)).toMatch(
      /^clip-c1-speedvar-[0-9a-f]+\.mp4$/,
    );
  });
});

describe("buildAudioSpeedFilterArgs (S4 — AudioClip static speed via atempo)", () => {
  it("atrim [in,out] + atempo chain, audio-only map (no video stream)", () => {
    const args = buildAudioSpeedFilterArgs("a.m4a", "out.m4a", 0, 3, 1.5, 30);
    const f = args[args.indexOf("-filter_complex") + 1];
    expect(f).toContain("atrim=start=0:end=3");
    expect(f).toContain("atempo=1.5000");
    expect(args).toContain("[a]");
    expect(args).not.toContain("[v]");
    expect(args[args.length - 1]).toBe("out.m4a");
  });

  it("chains atempo past the [0.5,2] instance range (speed 4 → 2×2)", () => {
    const args = buildAudioSpeedFilterArgs("a.m4a", "out.m4a", 0, 4, 4, 30);
    const f = args[args.indexOf("-filter_complex") + 1];
    expect(f).toContain("atempo=2.0000,atempo=2.0000");
  });
});

describe("audioSpeedCacheName (S4)", () => {
  it("greppable prefix + speed/fps in the key", () => {
    expect(audioSpeedCacheName("a1", 1.5, 0, 3, 30)).toMatch(
      /^clip-a1-speedaud-[0-9a-f]+\.m4a$/,
    );
    expect(audioSpeedCacheName("a1", 1.5, 0, 3, 30)).toBe(
      audioSpeedCacheName("a1", 1.5, 0, 3, 30),
    );
    expect(audioSpeedCacheName("a1", 1.5, 0, 3, 30)).not.toBe(
      audioSpeedCacheName("a1", 2.0, 0, 3, 30),
    );
  });
});

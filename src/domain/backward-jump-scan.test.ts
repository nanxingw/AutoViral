import { describe, it, expect } from "vitest";
import { scanBackwardJumps } from "./backward-jump-scan.js";

// S1 (PRD-0012) — jitter-scan pure core. Detects the "backward jump" signature
// docs/issues/026 found burned into exported mp4s: a frame whose diff vs the
// PRECEDING frame is large (the picture is moving) yet whose diff vs one of the
// previous 2-12 frames is near-zero (the decoder rewound to an earlier
// keyframe-anchored frame instead of advancing). The reference implementation
// (026 lines 26-50) is the algorithmic baseline this pins.
//
// Frames here are tiny synthetic grayscale buffers (not real 32x18 — the
// algorithm only cares about per-pixel mean-absolute-difference, so any fixed
// frame size works for unit tests). Each frame is a flat Uint8Array of
// intensity values.

function flat(value: number, size = 8): Uint8Array {
  return new Uint8Array(size).fill(value);
}

// Build a frame sequence where intensity ramps up by `step` each tick — pure
// linear motion, no rewinds. mad(t, t-1) is constant and > 0 for every t>0.
function linearMotionFrames(n: number, step = 20, size = 8): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    // Intensity wraps within [0,255] so it stays a valid byte, but each frame
    // still differs meaningfully from its neighbours (mad ~= step for i>0).
    frames.push(flat((i * step) % 256, size));
  }
  return frames;
}

describe("scanBackwardJumps", () => {
  it("linear motion, no rewinds → 0 events", () => {
    const frames = linearMotionFrames(40, 15);
    const events = scanBackwardJumps(frames, 24);
    expect(events).toEqual([]);
  });

  it("static frame sequence (frozen picture) → 0 events, no false positive", () => {
    const frames = Array.from({ length: 30 }, () => flat(128));
    const events = scanBackwardJumps(frames, 24);
    expect(events).toEqual([]);
  });

  it("adjacent frozen frames inside otherwise-moving footage → no false positive", () => {
    // Motion for a while, then a short freeze (repeated identical frames —
    // e.g. an encoder duplicate), then motion resumes. A freeze is NOT a
    // backward jump: d1 across the freeze boundary is 0 (frame N+1 == frame N),
    // so it never crosses the MOVING threshold and is correctly ignored.
    const frames: Uint8Array[] = [];
    for (let i = 0; i < 10; i++) frames.push(flat((i * 20) % 256));
    const frozenValue = frames[9]![0]!;
    for (let i = 0; i < 5; i++) frames.push(flat(frozenValue)); // held frame repeats
    for (let i = 10; i < 20; i++) frames.push(flat((i * 20) % 256));
    const events = scanBackwardJumps(frames, 24);
    expect(events).toEqual([]);
  });

  it("an inserted 'rewind k frames' segment is detected with the correct k", () => {
    // Build clean linear motion, then splice in a segment that jumps BACK to
    // an earlier frame's exact value (as if playback seeked to a stale
    // keyframe) before continuing forward — the exact signature the real
    // export bug produces (026: "跳回前几帧").
    const clean = linearMotionFrames(20, 20);
    const K = 5; // rewind distance: new frame (index clean.length) === clean[clean.length - K]
    const rewoundFrame = clean[clean.length - K]!; // frame the seek "lands on"
    const frames = [
      ...clean,
      rewoundFrame, // this frame: big diff vs clean's last frame, near-identical to frame (t-K)
      ...linearMotionFrames(10, 20).map((f) => flat((f[0]! + 200) % 256)), // motion resumes
    ];
    const events = scanBackwardJumps(frames, 24);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const hit = events.find((e) => e.t === clean.length);
    expect(hit).toBeDefined();
    expect(hit!.k).toBe(K);
    expect(hit!.sec).toBeCloseTo(clean.length / 24, 2);
  });

  it("multiple rewind events across a longer sequence are all reported", () => {
    const segment = () => {
      const clean = linearMotionFrames(15, 20);
      const K = 3;
      const rewound = clean[clean.length - K]!;
      return [...clean, rewound];
    };
    const frames = [...segment(), ...segment(), ...segment()];
    const events = scanBackwardJumps(frames, 30);
    expect(events.length).toBe(3);
    for (const e of events) {
      expect(e.k).toBe(3);
    }
  });

  it("too few frames (<3) → 0 events, no crash", () => {
    expect(scanBackwardJumps([], 24)).toEqual([]);
    expect(scanBackwardJumps([flat(1)], 24)).toEqual([]);
    expect(scanBackwardJumps([flat(1), flat(2)], 24)).toEqual([]);
  });
});

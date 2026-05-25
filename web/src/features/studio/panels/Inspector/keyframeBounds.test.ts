import { describe, it, expect } from "vitest";
import { clipKeyframeDuration, clampKeyframeTime } from "./keyframeBounds";
import type { Clip } from "../../types";

// Minimal clip fixtures — only the fields keyframeBounds reads.
const videoClip = { kind: "video", in: 1, out: 5 } as unknown as Clip; // dur 4
const audioClip = { kind: "audio", in: 0, out: 3 } as unknown as Clip; // dur 3
const overlayClip = { kind: "overlay", duration: 2 } as unknown as Clip;
const textClip = { kind: "text", duration: 2 } as unknown as Clip;

// Regression net for #40: keyframe TIME had no upper bound, so t=99999 on a 4s
// clip was silently persisted and corrupted the curve. These lock the bound.
describe("clipKeyframeDuration", () => {
  it("uses out-in for video/audio clips", () => {
    expect(clipKeyframeDuration(videoClip)).toBe(4);
    expect(clipKeyframeDuration(audioClip)).toBe(3);
  });
  it("uses the explicit duration for overlay clips", () => {
    expect(clipKeyframeDuration(overlayClip)).toBe(2);
  });
  it("returns 0 for text clips (no keyframes)", () => {
    expect(clipKeyframeDuration(textClip)).toBe(0);
  });
  it("never returns negative even on inverted in/out", () => {
    expect(clipKeyframeDuration({ kind: "video", in: 5, out: 1 } as unknown as Clip)).toBe(0);
  });
});

describe("clampKeyframeTime", () => {
  it("clamps the #40 repro (t=99999 on a 4s clip) down to clip duration", () => {
    expect(clampKeyframeTime(99999, videoClip)).toBe(4);
  });
  it("clamps negative times up to 0", () => {
    expect(clampKeyframeTime(-3, videoClip)).toBe(0);
  });
  it("passes through in-range times unchanged", () => {
    expect(clampKeyframeTime(2.5, videoClip)).toBe(2.5);
    expect(clampKeyframeTime(0, videoClip)).toBe(0);
    expect(clampKeyframeTime(4, videoClip)).toBe(4);
  });
  it("maps non-finite input (NaN / Infinity) to 0", () => {
    expect(clampKeyframeTime(NaN, videoClip)).toBe(0);
    expect(clampKeyframeTime(Infinity, videoClip)).toBe(0);
    expect(clampKeyframeTime(-Infinity, videoClip)).toBe(0);
  });
});

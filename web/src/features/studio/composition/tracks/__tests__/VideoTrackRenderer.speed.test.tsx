import { describe, expect, it } from "vitest";
import {
  computeVideoSpeedForFrame,
  effectiveClipDuration,
} from "@shared/speed-ramp";
import { computeVideoTransformForFrame } from "../VideoTrackRenderer";
import type { VideoClip } from "../../../types";

// Phase 8.3.C — pure-helper coverage for the speed-keyframe path. The
// VideoTrackRenderer feeds these helpers to Remotion (`playbackRate` prop +
// Sequence durationInFrames); we test the helpers directly to avoid coupling
// to OffthreadVideo's DOM contract under happy-dom.
//
// The renderer also keeps computing the CSS transform via
// computeVideoTransformForFrame; "speed" keyframes must NOT bleed into the
// transform string (D8) — the last test pins this guard.

describe("VideoTrackRenderer — speed keyframes", () => {
  const baseClip: VideoClip = {
    id: "v1",
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 4,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
  const fps = 30;

  it("playbackRate falls back to 1.0 when no speed keyframes (D3)", () => {
    expect(computeVideoSpeedForFrame(baseClip, 0, fps)).toBe(1.0);
    expect(computeVideoSpeedForFrame(baseClip, 30, fps)).toBe(1.0);
  });

  it("playbackRate equals the static speed when all speed kfs match (D6 fast-path)", () => {
    const clip: VideoClip = {
      ...baseClip,
      keyframes: [
        { property: "speed", time: 0, value: 2.0, easing: "linear" },
        { property: "speed", time: 4, value: 2.0, easing: "linear" },
      ],
    };
    expect(computeVideoSpeedForFrame(clip, 15, fps)).toBeCloseTo(2.0, 6);
    expect(computeVideoSpeedForFrame(clip, 60, fps)).toBeCloseTo(2.0, 6);
  });

  it("playbackRate ramps per frame for a variable speed curve", () => {
    const clip: VideoClip = {
      ...baseClip,
      keyframes: [
        { property: "speed", time: 0, value: 1.0, easing: "linear" },
        { property: "speed", time: 2, value: 2.0, easing: "linear" },
      ],
    };
    // t=0 → 1.0; t=1s (frame 30) → 1.5 midpoint; t=2s+ → clamped to last kf 2.0.
    expect(computeVideoSpeedForFrame(clip, 0, fps)).toBeCloseTo(1.0, 6);
    expect(computeVideoSpeedForFrame(clip, 30, fps)).toBeCloseTo(1.5, 6);
    expect(computeVideoSpeedForFrame(clip, 90, fps)).toBeCloseTo(2.0, 6);
  });

  it("speed kfs do NOT route through the CSS transform path (D8)", () => {
    // A speed=2 keyframe should NOT influence scale/x/y/rotation. The static
    // transforms object is the only fallback for those properties.
    const clip: VideoClip = {
      ...baseClip,
      transforms: { scale: 1, x: 10, y: 20, rotation: 5 },
      keyframes: [
        { property: "speed", time: 0, value: 2.0, easing: "linear" },
        { property: "speed", time: 4, value: 2.0, easing: "linear" },
      ],
    };
    const out = computeVideoTransformForFrame(clip, 30, fps);
    expect(out.scale).toBe(1);
    expect(out.x).toBe(10);
    expect(out.y).toBe(20);
    expect(out.rotation).toBe(5);
    // Sequence's durationInFrames will be Math.round(effectiveClipDuration(c) * fps)
    // = Math.round(2 * 30) = 60 frames (half of source @ speed=2).
    expect(Math.round(effectiveClipDuration(clip) * fps)).toBe(60);
  });
});

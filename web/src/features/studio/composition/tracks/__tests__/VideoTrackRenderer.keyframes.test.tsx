import { describe, it, expect } from "vitest";
import {
  computeVideoOpacityForFrame,
  computeVideoTransformForFrame,
} from "../VideoTrackRenderer";
import type { VideoClip } from "../../../types";

// Phase 8.2.C — at frame 30 (1s @ 30fps), with keyframes
//   [{property:"scale",time:0,value:1},{property:"scale",time:2,value:2}],
// the linear midpoint at time=1s is value 1.5. Other transform props (x/y/
// rotation) have no keyframes → fall back to clip.transforms (D9).

describe("computeVideoTransformForFrame", () => {
  const baseClip: VideoClip = {
    id: "v1",
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    fitMode: "cover",
    transforms: { scale: 1, x: 10, y: 20, rotation: 5 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
  const fps = 30;

  it("interpolates scale from keyframes at the linear midpoint (1s into a 2s ramp)", () => {
    const clip: VideoClip = {
      ...baseClip,
      keyframes: [
        { property: "scale", time: 0, value: 1, easing: "linear" },
        { property: "scale", time: 2, value: 2, easing: "linear" },
      ],
    };
    const out = computeVideoTransformForFrame(clip, 30, fps);
    expect(out.scale).toBeCloseTo(1.5, 4);
    // No keyframes for x/y/rotation → fallback to static (D9)
    expect(out.x).toBe(10);
    expect(out.y).toBe(20);
    expect(out.rotation).toBe(5);
  });

  it("falls back entirely to clip.transforms when keyframes is undefined (D9)", () => {
    const out = computeVideoTransformForFrame(baseClip, 30, fps);
    expect(out.scale).toBe(1);
    expect(out.x).toBe(10);
    expect(out.y).toBe(20);
    expect(out.rotation).toBe(5);
  });
});

// Crossfade fix — opacity keyframes were previously dropped on the floor by
// VideoTrackRenderer (only OverlayTrackRenderer honored them), so adjacent
// clips designed to crossfade actually hard-cut. computeVideoOpacityForFrame
// closes that gap so the renderer can apply CSS alpha-compositing.

describe("computeVideoOpacityForFrame", () => {
  const baseClip: VideoClip = {
    id: "v1",
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    fitMode: "cover",
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
  const fps = 24;

  it("interpolates opacity at the linear midpoint of a fade-in (0.09s into a 0.18s ramp)", () => {
    const clip: VideoClip = {
      ...baseClip,
      keyframes: [
        { property: "opacity", time: 0, value: 0, easing: "linear" },
        { property: "opacity", time: 0.18, value: 1, easing: "linear" },
      ],
    };
    // frame ≈ 2.16 at 24fps → clip-local 0.09s → midpoint opacity ≈ 0.5
    expect(computeVideoOpacityForFrame(clip, 2.16, fps)).toBeCloseTo(0.5, 3);
  });

  it("returns 1 when no opacity keyframe is defined (default visible)", () => {
    expect(computeVideoOpacityForFrame(baseClip, 30, fps)).toBe(1);
  });

  it("returns 1 when only non-opacity keyframes exist (scale should not bleed into opacity)", () => {
    const clip: VideoClip = {
      ...baseClip,
      keyframes: [
        { property: "scale", time: 0, value: 1, easing: "linear" },
        { property: "scale", time: 1, value: 2, easing: "linear" },
      ],
    };
    expect(computeVideoOpacityForFrame(clip, 12, fps)).toBe(1);
  });
});

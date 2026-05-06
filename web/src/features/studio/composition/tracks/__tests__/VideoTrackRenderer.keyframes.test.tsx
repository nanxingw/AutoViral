import { describe, it, expect } from "vitest";
import { computeVideoTransformForFrame } from "../VideoTrackRenderer";
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

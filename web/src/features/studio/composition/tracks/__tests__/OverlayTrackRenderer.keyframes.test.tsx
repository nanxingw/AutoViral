import { describe, it, expect } from "vitest";
import { computeOverlayPropsForFrame } from "../OverlayTrackRenderer";
import type { OverlayClip } from "../../../types";

// Phase 8.2.C — at frame 15 (0.5s @ 30fps), with opacity keyframes
//   [{property:"opacity",time:0,value:0},{property:"opacity",time:1,value:1}],
// the linear midpoint at time=0.5s is opacity 0.5. Other transform props
// (scale/x/y/rotation) have no KFs → 0/0/0/1 defaults from helper.

describe("computeOverlayPropsForFrame", () => {
  const baseClip: OverlayClip = {
    id: "o1",
    kind: "overlay",
    src: "/x.png",
    trackOffset: 0,
    duration: 2,
    position: { xPct: 10, yPct: 10, wPct: 50, hPct: 50 },
    opacity: 0.7,
  };
  const fps = 30;

  it("interpolates opacity from keyframes at the linear midpoint (0.5s into a 1s ramp)", () => {
    const clip: OverlayClip = {
      ...baseClip,
      opacity: 1,
      keyframes: [
        { property: "opacity", time: 0, value: 0, easing: "linear" },
        { property: "opacity", time: 1, value: 1, easing: "linear" },
      ],
    };
    const out = computeOverlayPropsForFrame(clip, 15, fps);
    expect(out.opacity).toBeCloseTo(0.5, 4);
    // No KFs for transform — all default to identity
    expect(out.scale).toBe(1);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.rotation).toBe(0);
  });

  it("falls back to clip.opacity when keyframes is undefined (D9)", () => {
    const out = computeOverlayPropsForFrame(baseClip, 15, fps);
    expect(out.opacity).toBe(0.7);
  });
});

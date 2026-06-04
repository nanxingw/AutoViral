import { describe, it, expect } from "vitest";
import {
  computeVideoOpacityForFrame,
  computeVideoTransformForFrame,
} from "../VideoTrackRenderer";
import type { VideoClip } from "../../../types";
import { setAspectRatio } from "@shared/composition/ops";
import type { Composition } from "@shared/composition";

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

  // S17 anti-dead-field — proves setAspectRatio's KEYFRAME rescaling is REALLY
  // consumed by the renderer's transform helper, not just written to schema.
  // A clip pans via x keyframes (so `interpolateProperty(kfs,"x",…) ?? t.x`
  // reads the keyframe, never the static t.x). After 9:16 → 16:9, the at-frame
  // x the renderer applies must be the keyframe value scaled by 1920/1080.
  it("renders the SCALED x-keyframe after setAspectRatio (op→renderer consumption)", () => {
    const clip: VideoClip = {
      ...baseClip,
      transforms: { scale: 1, x: 999, y: 0, rotation: 0 }, // static x must be ignored
      keyframes: [
        { property: "x", time: 0, value: 200, easing: "linear" },
        { property: "x", time: 2, value: 200, easing: "linear" }, // flat pan → constant 200
      ],
    };
    // Hand-built minimal 9:16 comp carrying this clip on a video track.
    const comp = {
      id: "c1",
      workId: "w1",
      schemaVersion: 1,
      fps,
      width: 1080,
      height: 1920,
      duration: 0,
      aspect: "9:16",
      tracks: [
        {
          id: "trk_v0",
          kind: "video",
          label: "V",
          displayOrder: 0,
          volume: 0,
          muted: false,
          hidden: false,
          clips: [clip],
          transitions: [],
        },
      ],
      assets: [],
      provenance: [],
    } as unknown as Composition;

    setAspectRatio(comp, { ratio: "16:9" });

    const scaledClip = comp.tracks[0].clips[0] as VideoClip;
    const out = computeVideoTransformForFrame(scaledClip, 30, fps); // 1s into the flat pan
    // The renderer reads the (now scaled) keyframe, NOT the static x:999.
    expect(out.x).toBeCloseTo(200 * (1920 / 1080), 4);
    expect(out.x).not.toBe(999);
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

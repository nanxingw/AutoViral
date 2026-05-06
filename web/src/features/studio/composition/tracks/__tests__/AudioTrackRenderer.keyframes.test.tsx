import { describe, it, expect } from "vitest";
import { computeAudioVolumeForFrame } from "../AudioTrackRenderer";
import { interpolateProperty } from "@shared/keyframes";
import type { AudioClip } from "../../../types";

// Phase 8.2.C — at frame 30 (1s @ 30fps), with volume keyframes
//   [{property:"volume",time:0,value:0},{property:"volume",time:2,value:1}],
// the linear midpoint at time=1s is value 0.5. With no fades on top, the
// final volume is also 0.5.

describe("AudioClip volume keyframe interpolation", () => {
  const baseClip: Omit<AudioClip, "src"> & { src: string } = {
    id: "a1",
    kind: "audio",
    src: "/x.mp3",
    in: 0,
    out: 5,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
  };
  const fps = 30;

  it("interpolates volume at linear midpoint and pipes it through computeAudioVolumeForFrame as base", () => {
    const clip: AudioClip = {
      ...baseClip,
      keyframes: [
        { property: "volume", time: 0, value: 0, easing: "linear" },
        { property: "volume", time: 2, value: 1, easing: "linear" },
      ],
    };
    const localFrame = 30;
    const localSec = localFrame / fps;
    const base = interpolateProperty(clip.keyframes, "volume", localSec) ?? clip.volume;
    expect(base).toBeCloseTo(0.5, 4);
    const v = computeAudioVolumeForFrame(clip, localFrame, fps, base);
    expect(v).toBeCloseTo(0.5, 4);
  });

  it("falls back to clip.volume when no volume keyframes present (D9)", () => {
    const clip: AudioClip = { ...baseClip, volume: 0.7 };
    const base = interpolateProperty(clip.keyframes, "volume", 1) ?? clip.volume;
    expect(base).toBe(0.7);
    const v = computeAudioVolumeForFrame(clip, 30, fps, base);
    expect(v).toBeCloseTo(0.7, 4);
  });
});

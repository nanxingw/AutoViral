import { describe, it, expect } from "vitest";
import { computeAudioVolumeForFrame } from "../AudioTrackRenderer";

describe("computeAudioVolumeForFrame", () => {
  // Clip: trackOffset=0, in=0, out=10s, base volume=1.0, fadeIn=2, fadeOut=2 @ 30fps
  // Phase 8.2.C: `base` is now passed explicitly so keyframe-driven volume
  // can ride into the same fade math without this helper knowing about KFs.
  const clip = { fadeIn: 2, fadeOut: 2, in: 0, out: 10 } as const;
  const fps = 30;

  it("returns 0 at the very start of fadeIn (frame 0)", () => {
    expect(computeAudioVolumeForFrame(clip, 0, fps, 1)).toBeCloseTo(0, 3);
  });

  it("returns full volume at the end of fadeIn (frame 60)", () => {
    expect(computeAudioVolumeForFrame(clip, 60, fps, 1)).toBeCloseTo(1, 3);
  });

  it("returns full volume in the middle of the clip (frame 150)", () => {
    expect(computeAudioVolumeForFrame(clip, 150, fps, 1)).toBeCloseTo(1, 3);
  });

  it("returns 0 at the very end of fadeOut (frame 300)", () => {
    expect(computeAudioVolumeForFrame(clip, 300, fps, 1)).toBeCloseTo(0, 3);
  });

  it("returns base * 0.5 at the midpoint of fadeOut (frame 270)", () => {
    expect(computeAudioVolumeForFrame(clip, 270, fps, 1)).toBeCloseTo(0.5, 3);
  });

  it("ignores fades when both are 0", () => {
    const flat = { fadeIn: 0, fadeOut: 0, in: 0, out: 5 };
    expect(computeAudioVolumeForFrame(flat, 0, fps, 0.8)).toBeCloseTo(0.8, 3);
    expect(computeAudioVolumeForFrame(flat, 75, fps, 0.8)).toBeCloseTo(0.8, 3);
  });
});

import { describe, it, expect } from "vitest";
import { clipDuration, clipEnd } from "./clipMath";
import { makeVideoClip, makeTextClip, makeAudioClip, makeOverlayClip } from "../../../../test/composition-fixtures";

describe("clipMath", () => {
  it("clipDuration on video uses out - in", () => {
    expect(clipDuration(makeVideoClip({ id: "v", in: 1.5, out: 4 }))).toBeCloseTo(2.5);
  });
  it("clipDuration on audio uses out - in", () => {
    expect(clipDuration(makeAudioClip({ id: "a", in: 0, out: 3.2 }))).toBeCloseTo(3.2);
  });
  it("clipDuration on text uses duration", () => {
    expect(clipDuration(makeTextClip({ id: "t", duration: 1.7 }))).toBeCloseTo(1.7);
  });
  it("clipDuration on overlay uses duration", () => {
    expect(clipDuration(makeOverlayClip({ id: "o", duration: 0.5 }))).toBeCloseTo(0.5);
  });
  it("clipEnd is trackOffset + clipDuration", () => {
    expect(clipEnd(makeVideoClip({ id: "v", trackOffset: 5, in: 0, out: 2 }))).toBeCloseTo(7);
    expect(clipEnd(makeTextClip({ id: "t", trackOffset: 3, duration: 1.2 }))).toBeCloseTo(4.2);
  });
});

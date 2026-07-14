import { describe, it, expect } from "vitest";
import {
  buildSpeedRampFilterArgs,
  buildVariableSpeedFilterArgs,
  type SpeedSegment,
} from "./speed-ramp-ffmpeg.js";
import { resolveSourceAudio } from "../shared/composition.js";

// PRD-0014 S5 — export-side source-audio drop. When a video clip's source audio
// is detached (sourceAudio.enabled=false), the speed-ramp pre-pass must NOT
// carry the embedded audio into its cache MP4 (belt-and-suspenders alongside the
// Remotion <OffthreadVideo muted> drop — the禁 "detach 后源声双份出声"). The pre-pass
// derives `hasAudio` from resolveSourceAudio(clip).enabled, so a detached clip
// yields a VIDEO-ONLY filtergraph (no `-map [a]`), and a default clip (no field,
// with a real audio stream) keeps `[a]`.

const SEGMENTS: SpeedSegment[] = [
  { srcStart: 0, srcEnd: 1, speed: 2, timelineDuration: 0.5 },
  { srcStart: 1, srcEnd: 2, speed: 1, timelineDuration: 1 },
];

function detachedClip() {
  return { sourceAudio: { enabled: false } };
}
function defaultClip() {
  return {}; // pre-S5 shape: no sourceAudio → enabled
}

describe("speed-ramp pre-pass drops detached source audio (S5)", () => {
  it("resolveSourceAudio gates hasAudio: detached → false, default → true (with probe)", () => {
    expect(resolveSourceAudio(detachedClip()).enabled).toBe(false);
    expect(resolveSourceAudio(defaultClip()).enabled).toBe(true);
  });

  it("static speed: a detached clip emits a VIDEO-ONLY graph (no -map [a])", () => {
    const hasAudio = resolveSourceAudio(detachedClip()).enabled; // false
    const args = buildSpeedRampFilterArgs("in.mp4", "out.mp4", 2, 30, hasAudio);
    const joined = args.join(" ");
    expect(joined).not.toContain("[a]");
    expect(joined).toContain("[v]");
  });

  it("static speed: a default clip (audio present) keeps -map [a]", () => {
    // enabled AND the source has an audio stream (probe=true)
    const hasAudio = resolveSourceAudio(defaultClip()).enabled && true;
    const args = buildSpeedRampFilterArgs("in.mp4", "out.mp4", 2, 30, hasAudio);
    expect(args.join(" ")).toContain("[a]");
  });

  it("variable speed: a detached clip emits a VIDEO-ONLY concat graph (no [a])", () => {
    const hasAudio = resolveSourceAudio(detachedClip()).enabled; // false
    const args = buildVariableSpeedFilterArgs("in.mp4", "out.mp4", SEGMENTS, 30, hasAudio);
    expect(args.join(" ")).not.toContain("[a]");
  });

  it("variable speed: a default clip keeps the audio concat ([a])", () => {
    const hasAudio = resolveSourceAudio(defaultClip()).enabled && true;
    const args = buildVariableSpeedFilterArgs("in.mp4", "out.mp4", SEGMENTS, 30, hasAudio);
    expect(args.join(" ")).toContain("[a]");
  });
});

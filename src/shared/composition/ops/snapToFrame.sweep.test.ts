import { describe, it, expect } from "vitest";
import type { Composition, Clip, Track } from "../../composition.js";
import {
  splitClip,
  trimClip,
  duplicateClip,
  importClip,
  addKeyframe,
  moveKeyframe,
  setCompositionDuration,
  setTransitionIn,
  reframeClip,
  addTransition,
  rippleDeleteClip,
  collapseGapsOnTrack,
  patchClipProps,
} from "./index.js";

// PRD-0014 S15 — sweep matrix over the WHOLE time-writing op family. Every op
// that lands an offset / in / out / durationSec / keyframe-time from a
// caller-supplied value MUST route it through the shared `snapToFrame` at its
// entry, so a sub-frame input (`--at 1.23456`) is quantised to a whole-frame
// boundary on read-back. One assertion per op family member — a new time-writing
// op added without snapping is caught the moment it joins this sweep.
const FPS = 30;

function isFrameAligned(sec: number, fps = FPS): boolean {
  return Math.abs(sec * fps - Math.round(sec * fps)) < 1e-6;
}

function videoClip(id: string, trackOffset: number, dur: number): Clip {
  return {
    id,
    kind: "video",
    src: `${id}.mp4`,
    in: 0,
    out: dur,
    trackOffset,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  } as unknown as Clip;
}

function compWith(clips: Clip[]): Composition {
  return {
    id: "c_test",
    workId: "test",
    schemaVersion: 1,
    fps: FPS,
    width: 1080,
    height: 1920,
    duration: 0,
    aspect: "9:16",
    tracks: [
      {
        id: "trk_v0",
        kind: "video",
        label: "V1",
        displayOrder: 0,
        volume: 0,
        muted: false,
        hidden: false,
        clips,
        transitions: [],
      } as unknown as Track,
    ],
    assets: [],
    provenance: [],
  } as unknown as Composition;
}

// Each case: build a comp, run the op with a SUB-FRAME time input, read back the
// value the op stored, and assert it is on a whole-frame boundary.
const cases: { name: string; readback: () => number }[] = [
  {
    name: "splitClip.atSec → child boundary snaps",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 4)]);
      const { newClipId } = splitClip(comp, { clipId: "a", atSec: 1.017 });
      const child = (comp.tracks[0].clips as Clip[]).find((c) => c.id === newClipId)!;
      return child.trackOffset;
    },
  },
  {
    name: "trimClip.in snaps",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 4)]);
      trimClip(comp, { clipId: "a", in: 1.017 });
      return (comp.tracks[0].clips[0] as { in: number }).in;
    },
  },
  {
    name: "trimClip.out snaps",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 4)]);
      trimClip(comp, { clipId: "a", out: 3.017 });
      return (comp.tracks[0].clips[0] as { out: number }).out;
    },
  },
  {
    name: "duplicateClip trackOffset snaps",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 4)]);
      const { newClipId } = duplicateClip(comp, { clipId: "a", offsetSec: 1.017 });
      const dup = (comp.tracks[0].clips as Clip[]).find((c) => c.id === newClipId)!;
      return dup.trackOffset;
    },
  },
  {
    name: "importClip.atSec → trackOffset snaps",
    readback: () => {
      const comp = compWith([]);
      const { clipId } = importClip(comp, {
        probe: { durationSec: 4 },
        src: "out/final.mp4",
        atSec: 1.017,
      });
      const clip = (comp.tracks[0].clips as Clip[]).find((c) => c.id === clipId)!;
      return clip.trackOffset;
    },
  },
  {
    name: "addKeyframe.atSec snaps",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 4)]);
      addKeyframe(comp, { clipId: "a", property: "opacity", atSec: 1.017, value: 0.5 });
      const kf = (comp.tracks[0].clips[0] as { keyframes: { time: number }[] }).keyframes[0];
      return kf.time;
    },
  },
  {
    name: "moveKeyframe.toSec snaps",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 4)]);
      addKeyframe(comp, { clipId: "a", property: "opacity", atSec: 1, value: 0.5 });
      moveKeyframe(comp, { clipId: "a", property: "opacity", fromSec: 1, toSec: 2.017 });
      const kf = (comp.tracks[0].clips[0] as { keyframes: { time: number }[] }).keyframes[0];
      return kf.time;
    },
  },
  {
    name: "setCompositionDuration.durationSec snaps",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 4)]);
      setCompositionDuration(comp, { durationSec: 3.017 });
      return comp.duration;
    },
  },
  {
    name: "setTransitionIn.durationSec snaps",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 4)]);
      setTransitionIn(comp, { clipId: "a", spec: { preset: "cross-dissolve", durationSec: 0.517 } });
      return (comp.tracks[0].clips[0] as { transitionIn: { durationSec: number } }).transitionIn
        .durationSec;
    },
  },
  {
    name: "reframeClip punch-in keyframe times snap (S8 reuse of shared helper)",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 4)]);
      reframeClip(comp, { clipId: "a", aspect: "9:16", punchInScale: 1.2, fromSec: 1.017, toSec: 3.017 });
      const kf = (comp.tracks[0].clips[0] as { keyframes: { property: string; time: number }[] })
        .keyframes.filter((k) => k.property === "scale")
        .sort((x, y) => x.time - y.time)[0];
      return kf.time;
    },
  },
  {
    name: "addTransition.durationSec snaps",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 3), videoClip("b", 3, 3)]);
      const { transitionId } = addTransition(comp, {
        trackId: "trk_v0",
        afterClipId: "a",
        preset: "cross-dissolve",
        durationSec: 0.517,
      });
      const tr = comp.tracks[0].transitions!.find((t) => t.id === transitionId)!;
      return tr.durationSec;
    },
  },
  {
    // FINDING 3 — a tiny explicit width snaps to 0, then clampHandleDuration
    // FLOORS at 0.05s = 1.5 frames @30fps. Frame-alignment must be a POST-clamp
    // postcondition, else the stored value is sub-frame again.
    name: "addTransition tiny durationSec (0.01) is frame-aligned after the handle clamp",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 3), videoClip("b", 3, 3)]);
      const { transitionId } = addTransition(comp, {
        trackId: "trk_v0",
        afterClipId: "a",
        preset: "cross-dissolve",
        durationSec: 0.01,
      });
      return comp.tracks[0].transitions!.find((t) => t.id === transitionId)!.durationSec;
    },
  },
  {
    // FINDING 3 — an OMITTED durationSec falls back to the preset registry
    // default (whip-pan-left = 0.35s = 10.5 frames @30fps), which bypassed snapping.
    name: "addTransition default preset duration (whip-pan-left 0.35) is frame-aligned",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 3), videoClip("b", 3, 3)]);
      const { transitionId } = addTransition(comp, {
        trackId: "trk_v0",
        afterClipId: "a",
        preset: "whip-pan-left",
      });
      return comp.tracks[0].transitions!.find((t) => t.id === transitionId)!.durationSec;
    },
  },
  {
    // FINDING 3 — setTransitionIn's auto-fit DEFAULT (registry default, no explicit
    // durationSec) also bypassed snapping; whip-pan-left 0.35 = 10.5 frames.
    name: "setTransitionIn default preset duration is frame-aligned",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 4)]);
      setTransitionIn(comp, { clipId: "a", spec: { preset: "whip-pan-left" } });
      return (comp.tracks[0].clips[0] as { transitionIn: { durationSec: number } }).transitionIn
        .durationSec;
    },
  },
  {
    // FINDING 3 — a keyframe authored AT a fractional-frame clip end used to clamp
    // to the fractional clip duration (2.06s = 61.8 frames @30fps). The clamp must
    // land on a whole frame ≤ the clip span.
    name: "addKeyframe at a fractional clip-end clamps to a whole frame",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 2.06)]);
      addKeyframe(comp, { clipId: "a", property: "opacity", atSec: 2.06, value: 0.5 });
      return (comp.tracks[0].clips[0] as { keyframes: { time: number }[] }).keyframes[0].time;
    },
  },
  {
    // FINDING 2 — importClip wrote the probe duration to `out` verbatim; a probe of
    // 4.017s = 120.51 frames @30fps left the clip end off-grid.
    name: "importClip.out (probe duration) snaps to a whole frame",
    readback: () => {
      const comp = compWith([]);
      const { clipId } = importClip(comp, { probe: { durationSec: 4.017 }, src: "out/x.mp4" });
      const clip = (comp.tracks[0].clips as Clip[]).find((c) => c.id === clipId)!;
      return (clip as { out: number }).out;
    },
  },
  {
    // FINDING 2 — rippleDeleteClip slides later clips by the removed clip's duration;
    // a fractional removed duration (1.017s) left the slid offset off-grid.
    name: "rippleDeleteClip slid offset is frame-aligned",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 1.017), videoClip("b", 2, 1)]);
      rippleDeleteClip(comp, { clipId: "a" });
      return (comp.tracks[0].clips as Clip[]).find((c) => c.id === "b")!.trackOffset;
    },
  },
  {
    // FINDING 2 — collapseGapsOnTrack repacks from a running cursor; a fractional
    // clip duration left the next clip's repacked offset off-grid.
    name: "collapseGapsOnTrack repacked offset is frame-aligned",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 1.017), videoClip("b", 5, 1)]);
      collapseGapsOnTrack(comp, { trackId: "trk_v0" });
      return (comp.tracks[0].clips as Clip[]).find((c) => c.id === "b")!.trackOffset;
    },
  },
  {
    // FINDING 1 — patchClipProps is the shared `clip set` op; a `--trackOffset
    // 1.017` (or --in/--out/--duration) written through it must snap to a whole
    // frame like every other time-writing op (fps threaded from the composition).
    name: "patchClipProps trackOffset snaps (CLI `clip set` path)",
    readback: () => {
      const comp = compWith([videoClip("a", 0, 4)]);
      patchClipProps(comp.tracks[0].clips[0] as Clip, { trackOffset: 1.017 }, comp.fps);
      return (comp.tracks[0].clips[0] as { trackOffset: number }).trackOffset;
    },
  },
];

describe("snapToFrame sweep — every time-writing op quantises its input (S15)", () => {
  it.each(cases)("$name", ({ readback }) => {
    const value = readback();
    expect(
      isFrameAligned(value),
      `stored time ${value} is not on a whole-frame boundary at ${FPS}fps ` +
        `(${value * FPS} frames)`,
    ).toBe(true);
  });

  it("import --at 1.23456 lands on a frame boundary (acceptance criterion)", () => {
    const comp = compWith([]);
    const { clipId } = importClip(comp, {
      probe: { durationSec: 5 },
      src: "out/final.mp4",
      atSec: 1.23456,
    });
    const clip = (comp.tracks[0].clips as Clip[]).find((c) => c.id === clipId)!;
    // 1.23456 @30fps = 37.0368 frames → frame 37 = 37/30 = 1.2333…s
    expect(clip.trackOffset).toBeCloseTo(37 / 30, 9);
    expect(isFrameAligned(clip.trackOffset)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import type { Composition, Clip, Track } from "../../composition.js";
import { rippleDeleteClip } from "./rippleDelete.js";

// Minimal single-video-track composition. Ops are pure in-place mutators so we
// never run CompositionSchema.parse here (ADR-009 decision #2).
function videoClip(id: string, trackOffset: number, dur: number): Clip {
  return {
    id,
    kind: "video",
    src: `${id}.mp4`,
    in: 0,
    out: dur,
    trackOffset,
    transforms: {},
    filters: {},
  } as unknown as Clip;
}

function compWith(clips: Clip[]): Composition {
  return {
    id: "c_test",
    workId: "test",
    schemaVersion: 1,
    fps: 30,
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

describe("ops.rippleDeleteClip", () => {
  it("removes the middle clip and shifts every later same-track clip left by its duration", () => {
    // a[0,2) b[2,5) c[5,6). Delete b (dur 3) → c slides left to 2.
    const comp = compWith([
      videoClip("a", 0, 2),
      videoClip("b", 2, 3),
      videoClip("c", 5, 1),
    ]);
    const { removed } = rippleDeleteClip(comp, { clipId: "b" });
    expect(removed).toBe(true);
    const clips = comp.tracks[0].clips as Clip[];
    expect(clips.map((c) => c.id)).toEqual(["a", "c"]);
    expect(clips.find((c) => c.id === "a")!.trackOffset).toBeCloseTo(0);
    expect(clips.find((c) => c.id === "c")!.trackOffset).toBeCloseTo(2);
  });

  it("recomputes comp.duration to the new content end", () => {
    const comp = compWith([
      videoClip("a", 0, 2),
      videoClip("b", 2, 3),
      videoClip("c", 5, 1),
    ]);
    rippleDeleteClip(comp, { clipId: "b" });
    // a end 2, c now [2,3) → duration 3.
    expect(comp.duration).toBeCloseTo(3);
  });

  it("leaves earlier clips untouched (only right side shifts)", () => {
    const comp = compWith([
      videoClip("a", 0, 4),
      videoClip("b", 4, 4),
    ]);
    rippleDeleteClip(comp, { clipId: "a" });
    const clips = comp.tracks[0].clips as Clip[];
    expect(clips.map((c) => c.id)).toEqual(["b"]);
    expect(clips[0].trackOffset).toBeCloseTo(0);
  });

  it("returns removed:false and touches nothing for an unknown clip id", () => {
    const comp = compWith([videoClip("a", 0, 2), videoClip("b", 2, 3)]);
    const beforeIds = (comp.tracks[0].clips as Clip[]).map((c) => c.id);
    const beforeOffsets = (comp.tracks[0].clips as Clip[]).map((c) => c.trackOffset);
    const { removed } = rippleDeleteClip(comp, { clipId: "missing" });
    expect(removed).toBe(false);
    expect((comp.tracks[0].clips as Clip[]).map((c) => c.id)).toEqual(beforeIds);
    expect((comp.tracks[0].clips as Clip[]).map((c) => c.trackOffset)).toEqual(
      beforeOffsets,
    );
  });

  it("mutates comp in place — never replaces the clips array reference (ADR-009 #1)", () => {
    const comp = compWith([videoClip("a", 0, 2), videoClip("b", 2, 3)]);
    const ref = comp.tracks[0].clips;
    rippleDeleteClip(comp, { clipId: "a" });
    expect(comp.tracks[0].clips).toBe(ref);
  });
});

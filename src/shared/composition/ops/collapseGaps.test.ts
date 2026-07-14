import { describe, it, expect } from "vitest";
import type { Composition, Clip, Track } from "../../composition.js";
import { collapseGapsOnTrack } from "./collapseGaps.js";

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

describe("ops.collapseGapsOnTrack", () => {
  it("repacks three clips with two gaps back-to-back from 0, preserving order", () => {
    // a[1,3) gap b[5,6) gap c[10,12). Collapse → 0,2,3.
    const comp = compWith([
      videoClip("a", 1, 2),
      videoClip("b", 5, 1),
      videoClip("c", 10, 2),
    ]);
    const { found, moved } = collapseGapsOnTrack(comp, { trackId: "trk_v0" });
    expect(found).toBe(true);
    expect(moved).toBe(true);
    const clips = comp.tracks[0].clips as Clip[];
    expect(clips.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(clips.map((c) => c.trackOffset)).toEqual([0, 2, 3]);
  });

  it("re-sorts out-of-order clips into ascending start order before repacking", () => {
    const comp = compWith([
      videoClip("late", 10, 2),
      videoClip("early", 1, 1),
    ]);
    collapseGapsOnTrack(comp, { trackId: "trk_v0" });
    const clips = comp.tracks[0].clips as Clip[];
    expect(clips.map((c) => c.id)).toEqual(["early", "late"]);
    expect(clips.map((c) => c.trackOffset)).toEqual([0, 1]);
  });

  it("recomputes comp.duration to the packed content end", () => {
    const comp = compWith([videoClip("a", 1, 2), videoClip("b", 5, 1)]);
    collapseGapsOnTrack(comp, { trackId: "trk_v0" });
    // packed: a[0,2) b[2,3) → duration 3.
    expect(comp.duration).toBeCloseTo(3);
  });

  it("reports moved:false when the track is already tight", () => {
    const comp = compWith([videoClip("a", 0, 2), videoClip("b", 2, 1)]);
    const { found, moved } = collapseGapsOnTrack(comp, { trackId: "trk_v0" });
    expect(found).toBe(true);
    expect(moved).toBe(false);
    const clips = comp.tracks[0].clips as Clip[];
    expect(clips.map((c) => c.trackOffset)).toEqual([0, 2]);
  });

  it("reports found:false for an unknown track id and touches nothing", () => {
    const comp = compWith([videoClip("a", 1, 2), videoClip("b", 5, 1)]);
    const { found } = collapseGapsOnTrack(comp, { trackId: "trk_nope" });
    expect(found).toBe(false);
    expect((comp.tracks[0].clips as Clip[]).map((c) => c.trackOffset)).toEqual([
      1, 5,
    ]);
  });

  it("mutates comp in place — never replaces the clips array reference (ADR-009 #1)", () => {
    const comp = compWith([videoClip("a", 1, 2), videoClip("b", 5, 1)]);
    const ref = comp.tracks[0].clips;
    collapseGapsOnTrack(comp, { trackId: "trk_v0" });
    expect(comp.tracks[0].clips).toBe(ref);
  });
});

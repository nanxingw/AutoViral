import { describe, it, expect } from "vitest";
import type { Composition, Clip } from "../../composition.js";
import { moveClipToTrack } from "./moveClipToTrack.js";
import { CompositionOpError } from "./errors.js";

// Minimal multi-track composition. The op is a pure in-place mutator so we
// never run CompositionSchema.parse here (ADR-009 decision #2).
function videoTrack(
  id: string,
  clips: Clip[],
  transitions: Array<{ id: string; afterClipId: string }> = [],
): unknown {
  return {
    id,
    kind: "video",
    label: id,
    displayOrder: 0,
    volume: 0,
    muted: false,
    hidden: false,
    clips,
    transitions,
  };
}
function audioTrack(id: string, clips: Clip[]): unknown {
  return {
    id,
    kind: "audio",
    label: id,
    displayOrder: 0,
    volume: 0,
    muted: false,
    hidden: false,
    clips,
    transitions: [],
  };
}

function compWith(tracks: unknown[]): Composition {
  return {
    id: "c_test",
    workId: "test",
    schemaVersion: 1,
    fps: 30,
    width: 1080,
    height: 1920,
    duration: 0,
    aspect: "9:16",
    tracks,
    assets: [],
    provenance: [],
  } as unknown as Composition;
}

function videoClip(id: string, trackOffset: number): Clip {
  return {
    id,
    kind: "video",
    src: "assets/x.mp4",
    in: 0,
    out: 4,
    trackOffset,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  } as unknown as Clip;
}

describe("@shared composition ops — moveClipToTrack", () => {
  it("moves a clip to another same-kind lane, preserving trackOffset, in place", () => {
    const v1 = videoTrack("trk_v1", [videoClip("c1", 2)]);
    const v2 = videoTrack("trk_v2", []);
    const comp = compWith([v1, v2]);
    const before = comp;
    const beforeTracks = comp.tracks;
    const beforeV1Clips = comp.tracks[0].clips;
    const beforeV2Clips = comp.tracks[1].clips;

    moveClipToTrack(comp, { clipId: "c1", targetTrackId: "trk_v2" });

    // clip left V1, landed on V2, keeping its trackOffset (time position).
    expect((comp.tracks[0].clips as Clip[]).length).toBe(0);
    const moved = comp.tracks[1].clips as Clip[];
    expect(moved).toHaveLength(1);
    expect(moved[0].id).toBe("c1");
    expect(moved[0].trackOffset).toBe(2);

    // decision #1: comp / tracks / track.clips references are NOT replaced.
    expect(comp).toBe(before);
    expect(comp.tracks).toBe(beforeTracks);
    expect(comp.tracks[0].clips).toBe(beforeV1Clips);
    expect(comp.tracks[1].clips).toBe(beforeV2Clips);
  });

  it("rejects a cross-kind move with CompositionOpError{code:4}", () => {
    const v1 = videoTrack("trk_v1", [videoClip("c1", 0)]);
    const a1 = audioTrack("trk_a1", []);
    const comp = compWith([v1, a1]);
    try {
      moveClipToTrack(comp, { clipId: "c1", targetTrackId: "trk_a1" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
    // clip stays on its source lane — no half-applied move.
    expect((comp.tracks[0].clips as Clip[]).map((c) => c.id)).toEqual(["c1"]);
    expect((comp.tracks[1].clips as Clip[]).length).toBe(0);
  });

  it("prunes the source-track transition anchored to the moved clip", () => {
    // V1 has c1 → c2 with a transition pinned after c1. Moving c1 to V2 orphans
    // that transition (afterClipId 'c1' no longer on V1) → must be pruned so the
    // next CompositionSchema.parse() superRefine does not reject.
    const v1 = videoTrack(
      "trk_v1",
      [videoClip("c1", 0), videoClip("c2", 4)],
      [{ id: "tr_1", afterClipId: "c1" }],
    );
    const v2 = videoTrack("trk_v2", []);
    const comp = compWith([v1, v2]);
    const beforeTransitions = comp.tracks[0].transitions;

    moveClipToTrack(comp, { clipId: "c1", targetTrackId: "trk_v2" });

    // The orphan transition is gone; the array reference is preserved (in-place).
    expect(comp.tracks[0].transitions).toHaveLength(0);
    expect(comp.tracks[0].transitions).toBe(beforeTransitions);
    // c1 moved, c2 stayed.
    expect((comp.tracks[0].clips as Clip[]).map((c) => c.id)).toEqual(["c2"]);
    expect((comp.tracks[1].clips as Clip[]).map((c) => c.id)).toEqual(["c1"]);
  });

  it("keeps an unrelated source-track transition (only the orphan is pruned)", () => {
    // V1: c1 → c2 → c3, transition pinned after c2. Moving c1 (NOT the anchor)
    // must NOT touch that transition.
    const v1 = videoTrack(
      "trk_v1",
      [videoClip("c1", 0), videoClip("c2", 4), videoClip("c3", 8)],
      [{ id: "tr_2", afterClipId: "c2" }],
    );
    const v2 = videoTrack("trk_v2", []);
    const comp = compWith([v1, v2]);

    moveClipToTrack(comp, { clipId: "c1", targetTrackId: "trk_v2" });

    expect(comp.tracks[0].transitions).toHaveLength(1);
    expect(comp.tracks[0].transitions![0].afterClipId).toBe("c2");
  });

  // S8 fix-up — the orphan-prune must also catch the SECOND failure mode: moving
  // a clip can make a *different* surviving clip the new LAST clip of the source
  // track. A transition pinned to that new-last clip then has no successor — the
  // Track superRefine ('transition pinned to the last clip has no successor')
  // rejects the next CompositionSchema.parse(). V1: c1 → c2 → c3 with a
  // transition pinned after c2 (valid, c3 succeeds it). Move c3 to V2 → V1
  // becomes [c1, c2], c2 is now last, the transition after c2 is orphaned. The
  // anchor-only prune (afterClipId === moved) would WRONGLY keep it.
  it("prunes a source-track transition that the move turns into a last-clip orphan", () => {
    const v1 = videoTrack(
      "trk_v1",
      [videoClip("c1", 0), videoClip("c2", 4), videoClip("c3", 8)],
      [{ id: "tr_2", afterClipId: "c2" }],
    );
    const v2 = videoTrack("trk_v2", []);
    const comp = compWith([v1, v2]);
    const beforeTransitions = comp.tracks[0].transitions;

    moveClipToTrack(comp, { clipId: "c3", targetTrackId: "trk_v2" });

    // c2 is now the last clip on V1; the transition pinned after it has no
    // successor and must be pruned (else the next parse superRefine rejects).
    expect((comp.tracks[0].clips as Clip[]).map((c) => c.id)).toEqual([
      "c1",
      "c2",
    ]);
    expect(comp.tracks[0].transitions).toHaveLength(0);
    // in-place: the transitions array reference is preserved.
    expect(comp.tracks[0].transitions).toBe(beforeTransitions);
    expect((comp.tracks[1].clips as Clip[]).map((c) => c.id)).toEqual(["c3"]);
  });

  it("throws code:4 for an unknown clipId", () => {
    const comp = compWith([videoTrack("trk_v1", [videoClip("c1", 0)]), videoTrack("trk_v2", [])]);
    try {
      moveClipToTrack(comp, { clipId: "nope", targetTrackId: "trk_v2" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("throws code:4 for an unknown target track", () => {
    const comp = compWith([videoTrack("trk_v1", [videoClip("c1", 0)])]);
    try {
      moveClipToTrack(comp, { clipId: "c1", targetTrackId: "trk_nope" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("is a no-op when the target is the clip's current track", () => {
    const comp = compWith([videoTrack("trk_v1", [videoClip("c1", 1)])]);
    moveClipToTrack(comp, { clipId: "c1", targetTrackId: "trk_v1" });
    expect((comp.tracks[0].clips as Clip[]).map((c) => c.id)).toEqual(["c1"]);
  });
});

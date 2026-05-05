import { describe, it, expect } from "vitest";
import { collapseGapsOnTrack } from "../collapseGaps";
import { makeVideoClip } from "../../../../../../test/composition-fixtures";
import type { Track } from "../../../../types";

// Tests parity with pneuma upstream (.cache/pneuma-clipcraft/.../toolbar/
// __tests__/collapseGaps.test.ts) — pneuma builds CompositionCommand[];
// our adaptation returns a new Track. Behavioural assertions
// (pack against zero, no-op when already packed, empty track is a no-op)
// are mirrored 1-to-1.

function makeTrack(clips: ReturnType<typeof makeVideoClip>[]): Track {
  return {
    id: "tv",
    kind: "video",
    label: "v",
    muted: false,
    hidden: false,
    clips,
  };
}

describe("collapseGapsOnTrack", () => {
  it("packs all clips back-to-back starting at 0", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 1, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 1 });
    const c = makeVideoClip({ id: "c", trackOffset: 8, in: 0, out: 3 });
    const out = collapseGapsOnTrack(makeTrack([a, b, c]));
    expect(out.clips.map((cl) => cl.trackOffset)).toEqual([0, 2, 3]);
  });

  it("preserves clip order even if input is unsorted", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 5, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 1, in: 0, out: 1 });
    const out = collapseGapsOnTrack(makeTrack([a, b]));
    // sorted by original trackOffset → b first
    expect(out.clips.map((cl) => cl.id)).toEqual(["b", "a"]);
    expect(out.clips.map((cl) => cl.trackOffset)).toEqual([0, 1]);
  });

  it("handles an empty track", () => {
    const out = collapseGapsOnTrack(makeTrack([]));
    expect(out.clips).toEqual([]);
  });

  it("idempotent on a track with no gaps", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 1 });
    const t = makeTrack([a, b]);
    const out1 = collapseGapsOnTrack(t);
    const out2 = collapseGapsOnTrack(out1);
    expect(out2.clips.map((c) => c.trackOffset)).toEqual([0, 2]);
  });

  // Edge case: pure helpers must not mutate input (covers immutable-shape
  // contract pneuma exercises by returning a fresh CompositionCommand[]).
  it("does not mutate the input track or clips", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 1, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 5, in: 0, out: 1 });
    const t = makeTrack([a, b]);
    const snapshotIds = t.clips.map((cl) => cl.id);
    const snapshotOffsets = t.clips.map((cl) => cl.trackOffset);
    collapseGapsOnTrack(t);
    expect(t.clips.map((cl) => cl.id)).toEqual(snapshotIds);
    expect(t.clips.map((cl) => cl.trackOffset)).toEqual(snapshotOffsets);
  });

  // Edge case: single-clip track with a head-gap should snap to 0.
  it("snaps a single clip's head-gap to zero", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 4, in: 0, out: 2 });
    const out = collapseGapsOnTrack(makeTrack([a]));
    expect(out.clips).toHaveLength(1);
    expect(out.clips[0].trackOffset).toBeCloseTo(0);
  });
});

import { describe, it, expect } from "vitest";
import { rippleDeleteFromTrack } from "../rippleDelete";
import { makeVideoClip } from "../../../../../../test/composition-fixtures";
import type { Track } from "../../../../types";

// Tests parity with pneuma upstream (.cache/pneuma-clipcraft/.../toolbar/
// __tests__/rippleDelete.test.ts) — pneuma builds CompositionCommand[];
// our adaptation returns a new Track. The behavioural assertions
// (remove + shift later, leave earlier alone, no-op when nothing later,
// unknown id is a no-op) are mirrored 1-to-1.

function makeTrack(clips: ReturnType<typeof makeVideoClip>[]): Track {
  return {
    id: "tv",
    kind: "video",
    label: "v",
    displayOrder: 0,
    volume: 0,
    muted: false,
    hidden: false,
    clips,
  };
}

describe("rippleDeleteFromTrack", () => {
  it("removes the target clip and shifts later clips left by its duration", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 3 });
    const c = makeVideoClip({ id: "c", trackOffset: 5, in: 0, out: 1 });
    const out = rippleDeleteFromTrack(makeTrack([a, b, c]), "b");
    expect(out.clips.map((cl) => cl.id)).toEqual(["a", "c"]);
    expect(out.clips[0].trackOffset).toBeCloseTo(0);
    // c was at 5, b had duration 3 → c shifts to 5 - 3 = 2
    expect(out.clips[1].trackOffset).toBeCloseTo(2);
  });

  it("returns the track unchanged if clipId is not found", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const t = makeTrack([a]);
    const out = rippleDeleteFromTrack(t, "missing");
    expect(out).toBe(t);
  });

  it("does not shift earlier clips", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 1 });
    const b = makeVideoClip({ id: "b", trackOffset: 3, in: 0, out: 2 });
    const c = makeVideoClip({ id: "c", trackOffset: 6, in: 0, out: 1 });
    const out = rippleDeleteFromTrack(makeTrack([a, b, c]), "b");
    // a stays at 0; c shifts left by b.duration (2) → 4
    expect(out.clips.find((cl) => cl.id === "a")!.trackOffset).toBeCloseTo(0);
    expect(out.clips.find((cl) => cl.id === "c")!.trackOffset).toBeCloseTo(4);
  });

  // Pneuma parity: "only emits remove-clip when there's nothing to shift"
  // (rippleDelete.test.ts:53-61).
  it("removes the last clip with no clips to shift", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 3 });
    const out = rippleDeleteFromTrack(makeTrack([a, b]), "b");
    expect(out.clips.map((cl) => cl.id)).toEqual(["a"]);
    expect(out.clips[0].trackOffset).toBeCloseTo(0);
  });

  // Edge case: deleting the sole clip on a track yields an empty track.
  it("handles a single-clip track", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const out = rippleDeleteFromTrack(makeTrack([a]), "a");
    expect(out.clips).toEqual([]);
  });

  // Edge case: pure helpers must not mutate input.
  it("does not mutate the input track or clips", () => {
    const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
    const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 3 });
    const c = makeVideoClip({ id: "c", trackOffset: 5, in: 0, out: 1 });
    const t = makeTrack([a, b, c]);
    const snapshotIds = t.clips.map((cl) => cl.id);
    const snapshotOffsets = t.clips.map((cl) => cl.trackOffset);
    rippleDeleteFromTrack(t, "b");
    expect(t.clips.map((cl) => cl.id)).toEqual(snapshotIds);
    expect(t.clips.map((cl) => cl.trackOffset)).toEqual(snapshotOffsets);
  });
});

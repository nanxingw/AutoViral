import { describe, it, expect } from "vitest";
import { detectTrackOverlaps, detectOverlaps, formatOverlap } from "./overlap.js";
import type { Composition } from "../composition.js";

// PRD-0014 S15 (review fix) — the shared structured overlap detector. Locks the
// three defects the duplicated preflight/lint loops had:
//   (5) speed-aware timeline width, not raw out-in;
//   (6) full pairwise sweep — nested non-adjacent pairs are all reported;
//   (4) STRUCTURED {clipAId, clipBId, start, end} records, not just a string.

function vClip(id: string, off: number, srcDur: number, speed?: number): unknown {
  return {
    id,
    kind: "video",
    src: `${id}.mp4`,
    in: 0,
    out: srcDur,
    trackOffset: off,
    ...(speed !== undefined
      ? { keyframes: [{ property: "speed", time: 0, value: speed, easing: "linear" }] }
      : {}),
  };
}
function oClip(id: string, off: number, dur: number): unknown {
  return { id, kind: "overlay", src: `${id}.png`, trackOffset: off, duration: dur };
}
function track(id: string, kind: string, clips: unknown[]): { id: string; kind: string; clips: unknown[] } {
  return { id, kind, clips };
}

describe("detectTrackOverlaps — structured records (S15 review)", () => {
  it("returns a structured {clipAId, clipBId, start, end} record for an overlap", () => {
    // a1 [0,3) overlaps a2 [2,5) on [2,3).
    const recs = detectTrackOverlaps(track("trk_v", "video", [vClip("a1", 0, 3), vClip("a2", 2, 3)]));
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ trackId: "trk_v", clipAId: "a1", clipBId: "a2", start: 2, end: 3 });
  });

  it("FINDING 6 — reports EVERY overlapping pair, including nested non-adjacent (A⊃C past B)", () => {
    // A=[0,10) B=[1,2) C=[3,4). Adjacent-only would report only B/A and miss C/A.
    const recs = detectTrackOverlaps(
      track("trk_v", "video", [vClip("A", 0, 10), vClip("B", 1, 1), vClip("C", 3, 1)]),
    );
    const pairs = recs.map((r) => `${r.clipBId}/${r.clipAId}`).sort();
    expect(pairs).toContain("B/A");
    expect(pairs).toContain("C/A"); // the pair the old adjacent-only loop dropped
  });

  it("FINDING 5 — a 2× clip occupies HALF the timeline (no false overlap with its neighbour)", () => {
    // source 4s @2× => timeline width 2 => [0,2); neighbour at 2 is adjacent, not overlapping.
    const recs = detectTrackOverlaps(track("trk_v", "video", [vClip("fast", 0, 4, 2), vClip("next", 2, 2)]));
    expect(recs).toHaveLength(0);
  });

  it("FINDING 5 — a 0.5× clip's stretched tail IS caught (raw out-in would miss it)", () => {
    // source 4s @0.5× => timeline width 8 => [0,8); neighbour at 5 overlaps on [5,8).
    const recs = detectTrackOverlaps(track("trk_v", "video", [vClip("slow", 0, 4, 0.5), vClip("tail", 5, 2)]));
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ clipAId: "slow", clipBId: "tail", start: 5, end: 7 });
  });

  it("half-open: clips that touch end-to-start are adjacent, not overlapping", () => {
    expect(detectTrackOverlaps(track("trk_v", "video", [vClip("a", 0, 3), vClip("b", 3, 3)]))).toEqual([]);
  });

  it("detectOverlaps EXEMPTS overlay tracks (PiP legally stacks)", () => {
    const comp = {
      tracks: [track("trk_o", "overlay", [oClip("p1", 0, 5), oClip("p2", 2, 5)])],
    } as unknown as Composition;
    expect(detectOverlaps(comp)).toEqual([]);
  });

  it("formatOverlap names BOTH clip ids", () => {
    const s = formatOverlap({ trackId: "trk_v", clipAId: "a1", clipBId: "a2", start: 2, end: 3 });
    expect(s).toContain("a1");
    expect(s).toContain("a2");
    expect(s).toContain("overlaps");
  });
});

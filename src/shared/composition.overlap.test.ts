import { describe, it, expect } from "vitest";
import { CompositionSchema, makeEmptyComposition } from "./composition.js";
import { preflight } from "./composition/preflight.js";

// PRD-0014 S15 — same-track overlap detection. video/audio clips that overlap on
// the same lane are a smell; overlay clips MAY overlap (picture-in-picture is a
// legal PiP stack). Interval is HALF-OPEN [start, end) so clips that touch
// end-to-start are adjacent, not overlapping. A finding names BOTH clip ids.
//
// DOWNGRADE (S15 禁 · "若存量数据有合法重叠则本版降级 warning"): the existing
// product contract ACCEPTS overlapping clips on write (bridge `POST /clip`, lint
// `track-overlap`, preflight all treat it as non-blocking), so this version keeps
// overlap at WARNING level (preflight/lint) rather than a hard schema rejection
// that would炸掉 existing overlapping works. These tests lock that: the composition
// still PARSES, and preflight surfaces the overlap as a non-blocking warning.

function comp(tracks: unknown[]): unknown {
  return {
    id: "c_overlap",
    workId: "w_overlap",
    schemaVersion: 1,
    fps: 30,
    width: 1080,
    height: 1920,
    duration: 20,
    aspect: "9:16",
    updatedAt: new Date("2026-07-14T00:00:00Z").toISOString(),
    tracks,
    assets: [],
    provenance: [],
    exportPresets: [],
  };
}

function videoTrack(clips: unknown[]): unknown {
  return { id: "trk_v0", kind: "video", label: "V1", displayOrder: 0, volume: 0, muted: false, hidden: false, clips, transitions: [] };
}
function audioTrack(clips: unknown[]): unknown {
  return { id: "trk_a0", kind: "audio", label: "A1", displayOrder: 1, volume: 0, muted: false, hidden: false, clips, transitions: [] };
}
function overlayTrack(clips: unknown[]): unknown {
  return { id: "trk_o0", kind: "overlay", label: "PiP", displayOrder: 2, volume: 0, muted: false, hidden: false, clips, transitions: [] };
}

function vClip(id: string, off: number, dur: number): unknown {
  return { id, kind: "video", src: `${id}.mp4`, in: 0, out: dur, trackOffset: off };
}
function aClip(id: string, off: number, dur: number): unknown {
  return { id, kind: "audio", src: `${id}.mp3`, in: 0, out: dur, trackOffset: off, volume: 1, fadeIn: 0, fadeOut: 0 };
}
function oClip(id: string, off: number, dur: number): unknown {
  return { id, kind: "overlay", src: `${id}.png`, trackOffset: off, duration: dur, position: { xPct: 10, yPct: 10, wPct: 30, hPct: 30 } };
}

function overlapWarnings(input: unknown): string[] {
  return preflight(input).warnings.filter((w) => w.includes("overlap"));
}

describe("refineTrack / preflight overlap detection (S15, warning-level)", () => {
  it("flags two overlapping video clips on the same track — names BOTH ids", () => {
    // a1 [0,3), a2 [2,5) — overlap on [2,3).
    const input = comp([videoTrack([vClip("a1", 0, 3), vClip("a2", 2, 3)])]);
    // The composition still PARSES (overlap is non-blocking this version)…
    expect(() => CompositionSchema.parse(input)).not.toThrow();
    expect(preflight(input).ok).toBe(true);
    // …but preflight surfaces the overlap as a warning naming both ids.
    const warns = overlapWarnings(input);
    expect(warns.length).toBeGreaterThan(0);
    expect(warns.join(" ")).toContain("a1");
    expect(warns.join(" ")).toContain("a2");
  });

  it("flags two overlapping audio clips on the same track", () => {
    const input = comp([audioTrack([aClip("m1", 0, 4), aClip("m2", 1, 4)])]);
    expect(overlapWarnings(input).length).toBeGreaterThan(0);
  });

  it("EXEMPTS overlapping overlay clips (picture-in-picture is legal)", () => {
    const input = comp([overlayTrack([oClip("p1", 0, 5), oClip("p2", 2, 5)])]);
    expect(() => CompositionSchema.parse(input)).not.toThrow();
    expect(overlapWarnings(input)).toEqual([]);
  });

  it("EXEMPTS two video clips that TOUCH end-to-start (half-open interval)", () => {
    // a1 [0,3), a2 [3,6) — adjacent, not overlapping.
    const input = comp([videoTrack([vClip("a1", 0, 3), vClip("a2", 3, 3)])]);
    expect(overlapWarnings(input)).toEqual([]);
  });

  it("EXEMPTS back-to-back video clips across a longer chain", () => {
    const input = comp([videoTrack([vClip("a", 0, 2), vClip("b", 2, 2), vClip("c", 4, 2)])]);
    expect(overlapWarnings(input)).toEqual([]);
  });

  it("regression — a fresh empty composition still parses and has no overlap warning", () => {
    const empty = makeEmptyComposition({ workId: "w_fresh", aspect: "9:16" });
    expect(() => CompositionSchema.parse(empty)).not.toThrow();
    expect(overlapWarnings(empty)).toEqual([]);
  });
});

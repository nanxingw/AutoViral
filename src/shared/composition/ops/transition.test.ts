import { describe, it, expect, vi } from "vitest";
import type { Composition, Clip } from "../../composition.js";
import { addTransition, removeTransition } from "./transition.js";
import { CompositionOpError } from "./errors.js";
import { TRANSITION_PRESETS } from "../../transitions.js";

// S9 (US 4/5/9) — shared transition ops. Pure in-place mutators (ADR-009): they
// never replace comp / comp.tracks / a track object, never run
// CompositionSchema.parse, and throw CompositionOpError{code:4} on illegal args
// (unknown track / clip, last-clip anchor, unknown preset, non-video track).

function compWith(
  clips: Clip[],
  extra: { audio?: boolean } = {},
): Composition {
  const tracks: unknown[] = [
    {
      id: "trk_v",
      kind: "video",
      label: "V1",
      displayOrder: 0,
      volume: 0,
      muted: false,
      hidden: false,
      clips: clips as never,
      transitions: [],
    },
  ];
  if (extra.audio) {
    tracks.push({
      id: "trk_a",
      kind: "audio",
      label: "A1",
      displayOrder: 1,
      volume: 0,
      muted: false,
      hidden: false,
      clips: [],
      transitions: [],
    });
  }
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

function videoClip(p: { id: string; trackOffset: number; in: number; out: number }): Clip {
  return {
    id: p.id,
    kind: "video",
    src: "assets/x.mp4",
    in: p.in,
    out: p.out,
    trackOffset: p.trackOffset,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  } as unknown as Clip;
}

describe("@shared composition ops — addTransition", () => {
  it("adds a transition between two clips in place and returns its id (preset default duration)", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "abc" as `${string}-${string}-${string}-${string}-${string}`,
    );
    const comp = compWith([
      videoClip({ id: "c1", trackOffset: 0, in: 0, out: 3 }),
      videoClip({ id: "c2", trackOffset: 3, in: 0, out: 3 }),
    ]);
    const track = comp.tracks[0];
    const transitionsRef = track.transitions; // identity must survive
    const { transitionId } = addTransition(comp, {
      trackId: "trk_v",
      afterClipId: "c1",
      preset: "cross-dissolve",
    });
    expect(transitionId).toBe("tr_abc");
    expect(track.transitions).toBe(transitionsRef); // same array (no replacement)
    expect(track.transitions).toHaveLength(1);
    expect(track.transitions![0].afterClipId).toBe("c1");
    expect(track.transitions![0].preset).toBe("cross-dissolve");
    expect(track.transitions![0].durationSec).toBeCloseTo(0.5, 5);
    expect(track.transitions![0].alignment).toBe("center");
    expect(track.transitions![0].easing).toBe("linear");
  });

  it("clamps a too-long duration to the handle (half of the smaller adjacent clip)", () => {
    const comp = compWith([
      videoClip({ id: "c1", trackOffset: 0, in: 0, out: 3 }),
      videoClip({ id: "c2", trackOffset: 3, in: 0, out: 3 }),
    ]);
    addTransition(comp, {
      trackId: "trk_v",
      afterClipId: "c1",
      preset: "cross-dissolve",
      durationSec: 99,
    });
    // both clips 3s → each donates half → cap 3s.
    expect(comp.tracks[0].transitions![0].durationSec).toBeCloseTo(3, 5);
  });

  it("seeds the transitions array when the track has none yet (and keeps comp/track identity)", () => {
    const comp = compWith([
      videoClip({ id: "c1", trackOffset: 0, in: 0, out: 3 }),
      videoClip({ id: "c2", trackOffset: 3, in: 0, out: 3 }),
    ]);
    // simulate a legacy track with no transitions field at all.
    delete (comp.tracks[0] as { transitions?: unknown }).transitions;
    const trackRef = comp.tracks[0];
    addTransition(comp, {
      trackId: "trk_v",
      afterClipId: "c1",
      preset: "wipe-left",
    });
    expect(comp.tracks[0]).toBe(trackRef); // same track object
    expect(comp.tracks[0].transitions).toHaveLength(1);
  });

  it("throws code:4 when afterClipId is the LAST clip (no successor)", () => {
    const comp = compWith([
      videoClip({ id: "c1", trackOffset: 0, in: 0, out: 3 }),
      videoClip({ id: "c2", trackOffset: 3, in: 0, out: 3 }),
    ]);
    try {
      addTransition(comp, { trackId: "trk_v", afterClipId: "c2", preset: "cross-dissolve" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionOpError);
      expect((e as CompositionOpError).code).toBe(4);
    }
    expect(comp.tracks[0].transitions ?? []).toHaveLength(0);
  });

  it("throws code:4 on an unknown preset (not in the shared registry)", () => {
    const comp = compWith([
      videoClip({ id: "c1", trackOffset: 0, in: 0, out: 3 }),
      videoClip({ id: "c2", trackOffset: 3, in: 0, out: 3 }),
    ]);
    try {
      addTransition(comp, {
        trackId: "trk_v",
        afterClipId: "c1",
        preset: "no-such-preset" as never,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionOpError);
      expect((e as CompositionOpError).code).toBe(4);
    }
  });

  it("throws code:4 on an unknown trackId", () => {
    const comp = compWith([
      videoClip({ id: "c1", trackOffset: 0, in: 0, out: 3 }),
      videoClip({ id: "c2", trackOffset: 3, in: 0, out: 3 }),
    ]);
    expect(() =>
      addTransition(comp, { trackId: "trk_nope", afterClipId: "c1", preset: "cross-dissolve" }),
    ).toThrow(CompositionOpError);
  });

  it("throws code:4 on an unknown afterClipId", () => {
    const comp = compWith([
      videoClip({ id: "c1", trackOffset: 0, in: 0, out: 3 }),
      videoClip({ id: "c2", trackOffset: 3, in: 0, out: 3 }),
    ]);
    expect(() =>
      addTransition(comp, { trackId: "trk_v", afterClipId: "ghost", preset: "cross-dissolve" }),
    ).toThrow(CompositionOpError);
  });

  it("accepts EVERY preset in the shared registry (op is bound to the single source of truth)", () => {
    for (const preset of TRANSITION_PRESETS) {
      const comp = compWith([
        videoClip({ id: "c1", trackOffset: 0, in: 0, out: 3 }),
        videoClip({ id: "c2", trackOffset: 3, in: 0, out: 3 }),
      ]);
      expect(() =>
        addTransition(comp, { trackId: "trk_v", afterClipId: "c1", preset }),
      ).not.toThrow();
      expect(comp.tracks[0].transitions![0].preset).toBe(preset);
    }
  });

  it("throws code:4 on a non-video track (Phase 1 video-only)", () => {
    const comp = compWith(
      [
        videoClip({ id: "c1", trackOffset: 0, in: 0, out: 3 }),
        videoClip({ id: "c2", trackOffset: 3, in: 0, out: 3 }),
      ],
      { audio: true },
    );
    expect(() =>
      addTransition(comp, { trackId: "trk_a", afterClipId: "c1", preset: "cross-dissolve" }),
    ).toThrow(CompositionOpError);
  });
});

describe("@shared composition ops — removeTransition", () => {
  it("removes the named transition in place (array identity survives) — restores a hard cut", () => {
    const comp = compWith([
      videoClip({ id: "c1", trackOffset: 0, in: 0, out: 3 }),
      videoClip({ id: "c2", trackOffset: 3, in: 0, out: 3 }),
    ]);
    const { transitionId } = addTransition(comp, {
      trackId: "trk_v",
      afterClipId: "c1",
      preset: "cross-dissolve",
    });
    const transitionsRef = comp.tracks[0].transitions;
    removeTransition(comp, { transitionId });
    expect(comp.tracks[0].transitions).toBe(transitionsRef); // same array
    expect(comp.tracks[0].transitions ?? []).toHaveLength(0); // hard cut restored
  });

  it("finds the transition across any track (no trackId needed)", () => {
    const comp = compWith([
      videoClip({ id: "c1", trackOffset: 0, in: 0, out: 3 }),
      videoClip({ id: "c2", trackOffset: 3, in: 0, out: 3 }),
    ]);
    const { transitionId } = addTransition(comp, {
      trackId: "trk_v",
      afterClipId: "c1",
      preset: "cross-dissolve",
    });
    expect(() => removeTransition(comp, { transitionId })).not.toThrow();
    expect(comp.tracks[0].transitions ?? []).toHaveLength(0);
  });

  it("throws code:4 on an unknown transitionId", () => {
    const comp = compWith([
      videoClip({ id: "c1", trackOffset: 0, in: 0, out: 3 }),
      videoClip({ id: "c2", trackOffset: 3, in: 0, out: 3 }),
    ]);
    try {
      removeTransition(comp, { transitionId: "tr_ghost" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionOpError);
      expect((e as CompositionOpError).code).toBe(4);
    }
  });
});

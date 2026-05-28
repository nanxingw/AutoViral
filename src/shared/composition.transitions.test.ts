import { describe, it, expect } from "vitest";
import { TransitionSchema, TrackSchema } from "./composition.js";

// #54 Phase 1 — schema-level guarantees for the transition object + the
// Track-level orphan / last-clip guards (superRefine).

function videoClip(id: string, trackOffset = 0, out = 3) {
  return {
    id, kind: "video", src: "x.mp4",
    in: 0, out, trackOffset,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
}

function videoTrack(over: Record<string, unknown> = {}) {
  return {
    id: "trk_v1", kind: "video", label: "V1",
    displayOrder: 0, volume: 0, muted: false, hidden: false,
    clips: [videoClip("a", 0, 3), videoClip("b", 3, 3)],
    transitions: [],
    ...over,
  };
}

describe("TransitionSchema (#54)", () => {
  it("accepts a minimal transition and fills defaults (duration/alignment/easing)", () => {
    const out = TransitionSchema.parse({
      id: "tr_1",
      afterClipId: "a",
      preset: "cross-dissolve",
    });
    expect(out.durationSec).toBeCloseTo(0.5, 5);
    expect(out.alignment).toBe("center");
    expect(out.easing).toBe("linear");
  });

  it("rejects an unknown preset", () => {
    expect(() =>
      TransitionSchema.parse({ id: "x", afterClipId: "a", preset: "bogus" }),
    ).toThrow();
  });

  it("rejects durationSec out of [0.05, 5]", () => {
    expect(() =>
      TransitionSchema.parse({ id: "x", afterClipId: "a", preset: "cross-dissolve", durationSec: 0 }),
    ).toThrow();
    expect(() =>
      TransitionSchema.parse({ id: "x", afterClipId: "a", preset: "cross-dissolve", durationSec: 99 }),
    ).toThrow();
  });
});

describe("TrackSchema transition guards (#54)", () => {
  it("accepts a valid transition pinned to a clip that has a successor", () => {
    const out = TrackSchema.parse(
      videoTrack({
        transitions: [{ id: "tr1", afterClipId: "a", preset: "cross-dissolve" }],
      }),
    );
    expect(out.transitions).toHaveLength(1);
  });

  it("rejects a transition whose afterClipId does not exist (orphan)", () => {
    expect(() =>
      TrackSchema.parse(
        videoTrack({
          transitions: [{ id: "tr1", afterClipId: "ghost", preset: "cross-dissolve" }],
        }),
      ),
    ).toThrow(/does not match any clip/);
  });

  it("rejects a transition pinned to the LAST clip (no successor to fade into)", () => {
    expect(() =>
      TrackSchema.parse(
        videoTrack({
          transitions: [{ id: "tr1", afterClipId: "b", preset: "cross-dissolve" }],
        }),
      ),
    ).toThrow(/no successor/);
  });

  it("defaults Track.transitions to [] when omitted", () => {
    const out = TrackSchema.parse({
      ...videoTrack(),
      transitions: undefined,
    });
    expect(out.transitions).toEqual([]);
  });
});

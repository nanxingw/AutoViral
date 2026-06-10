import { describe, it, expect } from "vitest";
import type { Composition, Clip } from "../../composition.js";
import {
  setCompositionDuration,
  compositionContentEnd,
} from "./setDuration.js";
import { CompositionOpError } from "./errors.js";

// Minimal composition; the op is a pure in-place mutator so we never run
// CompositionSchema.parse here (ADR-009 decision #2).
function compWith(clips: Clip[], duration = 0): Composition {
  return {
    id: "c_test",
    workId: "test",
    schemaVersion: 1,
    fps: 30,
    width: 1080,
    height: 1920,
    duration,
    aspect: "9:16",
    tracks: [
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
    ],
    assets: [],
    provenance: [],
  } as unknown as Composition;
}

function emptyComp(duration = 0): Composition {
  return {
    id: "c_empty",
    workId: "test",
    schemaVersion: 1,
    fps: 30,
    width: 1080,
    height: 1920,
    duration,
    aspect: "9:16",
    tracks: [],
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

describe("@shared composition ops — setCompositionDuration", () => {
  it("sets an explicit duration in place", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 0, out: 6 })], 6);
    setCompositionDuration(comp, { durationSec: 12 });
    expect(comp.duration).toBe(12);
  });

  it("allows shortening below the content end (cropping a tail is legitimate)", () => {
    // content end is 10 (offset 4 + 6s window); shortening to 7 is allowed.
    const comp = compWith([videoClip({ id: "a", trackOffset: 4, in: 0, out: 6 })], 10);
    setCompositionDuration(comp, { durationSec: 7 });
    expect(comp.duration).toBe(7);
  });

  it("accepts 0 as a valid explicit duration", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 0, out: 6 })], 6);
    setCompositionDuration(comp, { durationSec: 0 });
    expect(comp.duration).toBe(0);
  });

  it("auto mode derives from the maximum clip end (store口径)", () => {
    // two clips: ends at 6 and 13 (offset 8 + 5s window) → max 13.
    const comp = compWith(
      [
        videoClip({ id: "a", trackOffset: 0, in: 0, out: 6 }),
        videoClip({ id: "b", trackOffset: 8, in: 0, out: 5 }),
      ],
      99,
    );
    setCompositionDuration(comp, { auto: true });
    expect(comp.duration).toBe(13);
  });

  it("auto mode yields 0 for an empty composition (no tracks/clips)", () => {
    const comp = emptyComp(42);
    setCompositionDuration(comp, { auto: true });
    expect(comp.duration).toBe(0);
  });

  it("compositionContentEnd is the auto口径 and never returns -Infinity", () => {
    expect(compositionContentEnd(emptyComp(99))).toBe(0);
    const comp = compWith([videoClip({ id: "a", trackOffset: 3, in: 0, out: 4 })]);
    expect(compositionContentEnd(comp)).toBe(7);
  });

  it("rejects a negative duration with CompositionOpError code 4", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 0, out: 6 })], 6);
    expect(() => setCompositionDuration(comp, { durationSec: -5 })).toThrow(
      CompositionOpError,
    );
    try {
      setCompositionDuration(comp, { durationSec: -5 });
    } catch (err) {
      expect((err as CompositionOpError).code).toBe(4);
    }
    // duration left untouched on rejection.
    expect(comp.duration).toBe(6);
  });

  it("rejects NaN / non-finite durations with code 4", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 0, out: 6 })], 6);
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => setCompositionDuration(comp, { durationSec: bad })).toThrow(
        CompositionOpError,
      );
    }
    expect(comp.duration).toBe(6);
  });
});

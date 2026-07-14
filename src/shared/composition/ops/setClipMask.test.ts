import { describe, it, expect } from "vitest";
import type { Composition, Clip } from "../../composition.js";
import { setClipMask } from "./setClipMask.js";
import { CompositionOpError } from "./errors.js";

// PRD-0014 S13 — `setClipMask(clipId, spec | { preset } | null)`. Pure in-place
// mutator (ADR-009): never replaces comp/tracks/clip references, throws
// CompositionOpError{code:4} on illegal args (unknown/non-video clip, unknown
// shape/preset, out-of-range feather/rect). `spec === null` clears the mask. The
// Inspector mask controls + `autoviral clip mask` converge on THIS one op.
// Mask params are NOT keyframe-able this version.

function videoClip(p: { id: string; mask?: unknown }): Clip {
  return {
    id: p.id,
    kind: "video",
    src: "assets/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...(p.mask ? { mask: p.mask } : {}),
  } as unknown as Clip;
}

function audioClip(id: string): Clip {
  return {
    id,
    kind: "audio",
    src: "assets/a.mp3",
    in: 0,
    out: 5,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
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

function liveClip(comp: Composition, id: string): Record<string, unknown> {
  return (comp.tracks.flatMap((t) => t.clips as unknown[]) as Record<string, unknown>[]).find(
    (c) => c.id === id,
  )!;
}

describe("setClipMask (S13)", () => {
  it("sets a rect mask on a video clip", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    setClipMask(comp, { clipId: "v1", spec: { type: "rect" } });
    expect(liveClip(comp, "v1").mask).toEqual({ type: "rect" });
  });

  it("sets an ellipse mask carrying feather + inverted + rect", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    const spec = {
      type: "ellipse" as const,
      feather: 0.2,
      inverted: true,
      rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.6 },
    };
    setClipMask(comp, { clipId: "v1", spec });
    expect(liveClip(comp, "v1").mask).toEqual(spec);
  });

  it("expands the letterbox-2.35 preset to a centered rect band (keeps the band)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    setClipMask(comp, { clipId: "v1", spec: { preset: "letterbox-2.35" } });
    const mask = liveClip(comp, "v1").mask as {
      type: string;
      inverted?: boolean;
      rect: { x: number; y: number; w: number; h: number };
    };
    expect(mask.type).toBe("rect");
    // 1080x1920 (aspect 0.5625) / 2.35 = 0.239361… band height; centered.
    expect(mask.rect.h).toBeCloseTo(0.5625 / 2.35, 5);
    expect(mask.rect.y).toBeCloseTo((1 - 0.5625 / 2.35) / 2, 5);
    expect(mask.rect.x).toBe(0);
    expect(mask.rect.w).toBe(1);
  });

  it("rejects an unknown preset (code 4)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    expect(() =>
      setClipMask(comp, { clipId: "v1", spec: { preset: "letterbox-nope" } }),
    ).toThrow(CompositionOpError);
  });

  it("clears an existing mask when spec is null", () => {
    const comp = compWith([videoClip({ id: "v1", mask: { type: "rect" } })]);
    setClipMask(comp, { clipId: "v1", spec: null });
    expect(liveClip(comp, "v1").mask).toBeUndefined();
  });

  it("mutates IN PLACE — clip object identity survives", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    const before = liveClip(comp, "v1");
    setClipMask(comp, { clipId: "v1", spec: { type: "ellipse" } });
    expect(liveClip(comp, "v1")).toBe(before);
  });

  it("rejects an unknown clip id (code 4)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    try {
      setClipMask(comp, { clipId: "nope", spec: { type: "rect" } });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("rejects a non-video clip (code 4)", () => {
    const comp = compWith([audioClip("a1")]);
    expect(() =>
      setClipMask(comp, { clipId: "a1", spec: { type: "rect" } }),
    ).toThrow(CompositionOpError);
  });

  it("rejects an unknown shape (code 4)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    expect(() =>
      setClipMask(comp, {
        clipId: "v1",
        spec: { type: "star" as unknown as "rect" },
      }),
    ).toThrow(CompositionOpError);
  });

  it("rejects feather out of range (code 4)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    expect(() =>
      setClipMask(comp, { clipId: "v1", spec: { type: "rect", feather: 2 } }),
    ).toThrow(CompositionOpError);
  });

  it("rejects an out-of-bounds rect (code 4)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    expect(() =>
      setClipMask(comp, {
        clipId: "v1",
        spec: { type: "rect", rect: { x: 0.8, y: 0, w: 0.5, h: 1 } },
      }),
    ).toThrow(CompositionOpError);
  });

  it("a rejected set leaves the clip UNTOUCHED (atomic)", () => {
    const comp = compWith([videoClip({ id: "v1", mask: { type: "rect" } })]);
    expect(() =>
      setClipMask(comp, { clipId: "v1", spec: { type: "rect", feather: 9 } }),
    ).toThrow(CompositionOpError);
    expect(liveClip(comp, "v1").mask).toEqual({ type: "rect" });
  });
});

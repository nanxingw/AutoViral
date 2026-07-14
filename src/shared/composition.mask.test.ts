import { describe, it, expect } from "vitest";
import {
  VideoClipSchema,
  TrackSchema,
  CompositionWriteSchema,
  makeEmptyComposition,
} from "./composition.js";

// PRD-0014 S13 — `VideoClip.mask` (rect / ellipse shape mask with feather +
// inverted). Schema contract:
//   - `mask?: { type:"rect"|"ellipse", feather?:0..1, inverted?:boolean,
//     rect?:{x,y,w,h 归一化} }` OPTIONAL with NO default → EVERY pre-S13 work
//     (no key) parses IDENTICALLY (禁 "schema变更破坏存量 yaml").
//   - `feather` ∈ [0,1]; `rect` leaves ∈ [0,1] with positive area + in-bounds.
//   - mask params are NOT keyframe-able this version (禁) — a flat object, no
//     per-time array.

function bareVideoClip(over: Record<string, unknown> = {}) {
  return {
    id: "v1",
    kind: "video" as const,
    src: "assets/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...over,
  };
}

function videoTrack(clips: unknown[]) {
  return {
    id: "trk_v1",
    kind: "video" as const,
    label: "V1",
    displayOrder: 0,
    volume: 0,
    muted: false,
    hidden: false,
    clips,
    transitions: [],
  };
}

describe("VideoClip.mask schema (S13)", () => {
  it("a clip with NO mask key parses unchanged (back-compat)", () => {
    const parsed = VideoClipSchema.parse(bareVideoClip());
    expect((parsed as { mask?: unknown }).mask).toBeUndefined();
  });

  it("accepts a rect mask and round-trips it", () => {
    const parsed = VideoClipSchema.parse(
      bareVideoClip({ mask: { type: "rect" } }),
    );
    expect((parsed as { mask?: unknown }).mask).toEqual({ type: "rect" });
  });

  it("accepts an ellipse mask with feather + inverted + rect", () => {
    const mask = {
      type: "ellipse",
      feather: 0.2,
      inverted: true,
      rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.6 },
    };
    const parsed = VideoClipSchema.parse(bareVideoClip({ mask }));
    expect((parsed as { mask?: unknown }).mask).toEqual(mask);
  });

  it("rejects an unknown mask type", () => {
    expect(() =>
      VideoClipSchema.parse(bareVideoClip({ mask: { type: "star" } })),
    ).toThrow();
  });

  it("rejects feather out of [0,1]", () => {
    expect(() =>
      VideoClipSchema.parse(bareVideoClip({ mask: { type: "rect", feather: 1.5 } })),
    ).toThrow();
    expect(() =>
      VideoClipSchema.parse(bareVideoClip({ mask: { type: "rect", feather: -0.1 } })),
    ).toThrow();
  });

  it("rejects a rect with zero area (w=0)", () => {
    expect(() =>
      VideoClipSchema.parse(
        bareVideoClip({ mask: { type: "rect", rect: { x: 0, y: 0, w: 0, h: 1 } } }),
      ),
    ).toThrow();
  });

  it("rejects a rect that overruns the frame (x+w>1)", () => {
    expect(() =>
      VideoClipSchema.parse(
        bareVideoClip({ mask: { type: "rect", rect: { x: 0.8, y: 0, w: 0.5, h: 1 } } }),
      ),
    ).toThrow();
  });

  it("mask survives a full Track refine (video track)", () => {
    const track = videoTrack([
      bareVideoClip({ mask: { type: "ellipse", feather: 0.3 } }),
    ]);
    const parsed = TrackSchema.parse(track);
    const clip = (parsed.clips as { mask?: unknown }[])[0];
    expect(clip.mask).toEqual({ type: "ellipse", feather: 0.3 });
  });

  it("mask survives the strict CompositionWriteSchema (persistence path)", () => {
    const comp = makeEmptyComposition({ workId: "w_mask", aspect: "9:16" });
    const vTrack = comp.tracks.find((t) => t.kind === "video")!;
    (vTrack.clips as unknown[]).push(
      bareVideoClip({ mask: { type: "rect", inverted: true } }),
    );
    const parsed = CompositionWriteSchema.parse(comp);
    const clip = parsed.tracks
      .flatMap((t) => t.clips as { id: string; mask?: unknown }[])
      .find((c) => c.id === "v1");
    expect(clip?.mask).toEqual({ type: "rect", inverted: true });
  });
});

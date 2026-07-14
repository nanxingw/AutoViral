import { describe, it, expect } from "vitest";
import type { Composition, Clip, Keyframe } from "../../composition.js";
import { CompositionSchema } from "../../composition.js";
import { reframeClip } from "./reframeClip.js";
import { CompositionOpError } from "./errors.js";

// PRD-0014 S8 — `reframeClip` is PURE COMPOSITION SUGAR: it composes the
// existing crop transform + scale keyframes, introducing NO new schema field.
// Reframe to a narrower aspect crops a centered strip; an optional punch-in
// animates the `scale` curve over a frame-aligned [from, to] window.

function videoClip(p: { id: string; out?: number }): Clip {
  return {
    id: p.id,
    kind: "video",
    src: "assets/x.mp4",
    in: 0,
    out: p.out ?? 6,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  } as unknown as Clip;
}

function textClip(p: { id: string }): Clip {
  return {
    id: p.id,
    kind: "text",
    text: "hi",
    trackOffset: 0,
    duration: 5,
    style: { font: "Inter", size: 64, weight: 700, italic: false, tracking: 0, color: "#fff" },
    position: { anchor: "bottom", xPct: 50, yPct: 85 },
  } as unknown as Clip;
}

// A 16:9 (landscape) composition so a 9:16 reframe crops a vertical strip.
function compWith(clips: Clip[], fps = 30): Composition {
  return {
    id: "c_test",
    workId: "test",
    schemaVersion: 1,
    fps,
    width: 1920,
    height: 1080,
    duration: 0,
    aspect: "16:9",
    updatedAt: new Date("2026-07-14T00:00:00Z").toISOString(),
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

function clip0(comp: Composition) {
  return comp.tracks[0].clips[0] as {
    transforms: { crop?: { x: number; y: number; w: number; h: number } };
    keyframes?: Keyframe[];
  };
}

describe("@shared composition ops — reframeClip", () => {
  it("crops a centered vertical strip when reframing 16:9 → 9:16", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    reframeClip(comp, { clipId: "v1", aspect: "9:16" });
    const crop = clip0(comp).transforms.crop!;
    // target ratio 9/16=0.5625; comp ratio 1920/1080=1.7778 → w = 0.5625/1.7778
    const w = 0.5625 / (1920 / 1080);
    expect(crop.w).toBeCloseTo(w, 5);
    expect(crop.h).toBeCloseTo(1, 5);
    expect(crop.x).toBeCloseTo((1 - w) / 2, 5); // centered
    expect(crop.y).toBeCloseTo(0, 5);
    // No punch-in requested → no scale keyframes authored.
    expect(clip0(comp).keyframes).toBeUndefined();
  });

  it("authors a frame-aligned scale keyframe pair for a punch-in", () => {
    const comp = compWith([videoClip({ id: "v1", out: 6 })], 30);
    // from/to are sub-frame; expect them snapped to 30fps frame boundaries.
    reframeClip(comp, {
      clipId: "v1",
      aspect: "9:16",
      punchInScale: 1.3,
      fromSec: 0.02, // → round(0.02*30)/30 = 1/30 ≈ 0.0333
      toSec: 2.017, // → round(2.017*30)/30 = 61/30 ≈ 2.0333
    });
    const kfs = clip0(comp).keyframes!;
    const scale = kfs.filter((k) => k.property === "scale").sort((a, b) => a.time - b.time);
    expect(scale).toHaveLength(2);
    expect(scale[0].time).toBeCloseTo(1 / 30, 6);
    expect(scale[0].value).toBe(1);
    expect(scale[1].time).toBeCloseTo(61 / 30, 6);
    expect(scale[1].value).toBe(1.3);
  });

  it("defaults the punch-in window to [0, clip duration] when from/to are omitted", () => {
    const comp = compWith([videoClip({ id: "v1", out: 4 })], 30);
    reframeClip(comp, { clipId: "v1", aspect: "9:16", punchInScale: 1.2 });
    const scale = clip0(comp).keyframes!.filter((k) => k.property === "scale");
    expect(scale.map((k) => k.time).sort((a, b) => a - b)).toEqual([0, 4]);
  });

  it("produces a schema-valid composition (crop stays inside the frame)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    reframeClip(comp, { clipId: "v1", aspect: "1:1", punchInScale: 1.25, fromSec: 0, toSec: 3 });
    expect(() => CompositionSchema.parse(comp)).not.toThrow();
  });

  it("throws code:4 on an unknown clip / a non-video clip", () => {
    const comp = compWith([textClip({ id: "t1" }), videoClip({ id: "v1" })]);
    expect(() => reframeClip(comp, { clipId: "nope", aspect: "9:16" })).toThrow(
      CompositionOpError,
    );
    expect(() => reframeClip(comp, { clipId: "t1", aspect: "9:16" })).toThrow(
      CompositionOpError,
    );
  });

  it("throws code:4 on a malformed aspect string", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    expect(() => reframeClip(comp, { clipId: "v1", aspect: "banana" })).toThrow(
      CompositionOpError,
    );
    expect(() => reframeClip(comp, { clipId: "v1", aspect: "0:16" })).toThrow(
      CompositionOpError,
    );
  });
});

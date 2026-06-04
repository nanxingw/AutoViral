import { describe, it, expect } from "vitest";
import type { Composition } from "../../composition.js";
import { setAspectRatio } from "./setAspectRatio.js";
import { CompositionOpError } from "./errors.js";

// Pure in-place op (ADR-009 decision #2) → no CompositionSchema.parse here. We
// hand-build a minimal 9:16 comp with one video clip carrying an absolute pixel
// offset and one text clip positioned by percentage.
function videoClip(x: number, y: number): unknown {
  return {
    id: "v0",
    kind: "video",
    src: "a.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    transforms: { scale: 1, x, y, rotation: 0 },
    filters: {},
  };
}

function textClip(): unknown {
  return {
    id: "t0",
    kind: "text",
    text: "hello",
    trackOffset: 0,
    duration: 3,
    style: {},
    position: { anchor: "bottom", xPct: 50, yPct: 85 },
  };
}

function compWith(clips: unknown[]): Composition {
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
        id: "trk_v0",
        kind: "video",
        label: "V",
        displayOrder: 0,
        volume: 0,
        muted: false,
        hidden: false,
        clips,
        transitions: [],
      },
    ],
    assets: [],
    provenance: [],
  } as unknown as Composition;
}

describe("setAspectRatio (S17)", () => {
  it("9:16 → 1:1 sets canonical width/height/aspect", () => {
    const comp = compWith([videoClip(0, 0)]);
    setAspectRatio(comp, { ratio: "1:1" });
    expect(comp.aspect).toBe("1:1");
    expect(comp.width).toBe(1080);
    expect(comp.height).toBe(1080);
  });

  it("9:16 → 16:9 sets canonical landscape dims", () => {
    const comp = compWith([videoClip(0, 0)]);
    setAspectRatio(comp, { ratio: "16:9" });
    expect(comp.aspect).toBe("16:9");
    expect(comp.width).toBe(1920);
    expect(comp.height).toBe(1080);
  });

  it("16:9 → 9:16 sets canonical portrait dims", () => {
    const comp = compWith([videoClip(0, 0)]);
    comp.aspect = "16:9";
    comp.width = 1920;
    comp.height = 1080;
    setAspectRatio(comp, { ratio: "9:16" });
    expect(comp.aspect).toBe("9:16");
    expect(comp.width).toBe(1080);
    expect(comp.height).toBe(1920);
  });

  it("rescales a video clip's absolute pixel offset proportionally so it stays in frame", () => {
    // 9:16 (1080×1920) → 16:9 (1920×1080). sx = 1920/1080, sy = 1080/1920.
    const comp = compWith([videoClip(200, 400)]);
    setAspectRatio(comp, { ratio: "16:9" });
    const t = (comp.tracks[0].clips[0] as { transforms: { x: number; y: number } })
      .transforms;
    expect(t.x).toBeCloseTo(200 * (1920 / 1080), 4);
    expect(t.y).toBeCloseTo(400 * (1080 / 1920), 4);
  });

  it("narrowing the canvas shrinks a far-right offset so the clip does NOT fly off-frame", () => {
    // A clip nudged 900px right of centre on a 1920-wide (16:9) canvas. Switch to
    // 1:1 (1080 wide): the offset must scale DOWN (×1080/1920) to stay proportional.
    const comp = compWith([videoClip(900, 0)]);
    comp.aspect = "16:9";
    comp.width = 1920;
    comp.height = 1080;
    const before = 900;
    setAspectRatio(comp, { ratio: "1:1" });
    const t = (comp.tracks[0].clips[0] as { transforms: { x: number } }).transforms;
    expect(t.x).toBeCloseTo(before * (1080 / 1920), 4);
    expect(t.x).toBeLessThan(before); // shrank, not grew
    // Stays within half the new canvas width (it was within half the old one).
    expect(Math.abs(t.x)).toBeLessThanOrEqual(comp.width / 2);
  });

  it("leaves percentage-positioned text clips untouched (they adapt automatically)", () => {
    const comp = compWith([textClip()]);
    setAspectRatio(comp, { ratio: "16:9" });
    const pos = (comp.tracks[0].clips[0] as { position: { xPct: number; yPct: number } })
      .position;
    expect(pos.xPct).toBe(50);
    expect(pos.yPct).toBe(85);
  });

  it("re-applying the SAME ratio is inert (offsets unchanged)", () => {
    const comp = compWith([videoClip(200, 400)]);
    setAspectRatio(comp, { ratio: "9:16" });
    const t = (comp.tracks[0].clips[0] as { transforms: { x: number; y: number } })
      .transforms;
    expect(t.x).toBe(200);
    expect(t.y).toBe(400);
    expect(comp.aspect).toBe("9:16");
  });

  it("mutates comp IN PLACE — never replaces the comp reference (ADR-009 §1)", () => {
    const comp = compWith([videoClip(0, 0)]);
    const tracksRef = comp.tracks;
    const clipRef = comp.tracks[0].clips[0];
    setAspectRatio(comp, { ratio: "1:1" });
    expect(comp.tracks).toBe(tracksRef);
    expect(comp.tracks[0].clips[0]).toBe(clipRef);
  });

  it("rejects a non-canonical ratio with CompositionOpError code 4", () => {
    const comp = compWith([videoClip(0, 0)]);
    let caught: unknown;
    try {
      setAspectRatio(comp, { ratio: "21:9" as never });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompositionOpError);
    expect((caught as CompositionOpError).code).toBe(4);
    // comp left untouched on rejection.
    expect(comp.aspect).toBe("9:16");
    expect(comp.width).toBe(1080);
  });
});

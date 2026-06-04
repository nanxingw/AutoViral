import { describe, it, expect } from "vitest";
import type { Composition } from "../../composition.js";
import { setAspectRatio, rescaleCompositionForResize } from "./setAspectRatio.js";
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

// An overlay clip placed by PERCENTAGE (position.*Pct) but carrying optional x/y
// pan KEYFRAMES — which the renderer composes as ABSOLUTE PIXELS
// (`translate(${x}px,${y}px)`), so they are dimension-dependent just like a
// video pan and MUST be rescaled on a canvas resize.
function overlayClipWithKeyframes(
  kfs: { property: string; time: number; value: number; easing: string }[],
): unknown {
  return {
    id: "o0",
    kind: "overlay",
    src: "logo.png",
    trackOffset: 0,
    duration: 3,
    position: { xPct: 50, yPct: 50, wPct: 20, hPct: 20 },
    opacity: 1,
    keyframes: kfs,
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

  it("rescales x/y KEYFRAMES (not just static transforms) so a panned clip stays in frame", () => {
    // The renderer reads `interpolateProperty(kfs,\"x\",...) ?? t.x`, so on a clip
    // that pans via x/y keyframes the STATIC t.x is never read — only the
    // keyframe values drive position. If the op scales only t.x/t.y, a keyframed
    // pan animation keeps OLD-canvas absolute pixels and drifts off-frame
    // (exactly the \"drift off the canvas\" the op promises to prevent). 9:16
    // (1080×1920) → 16:9 (1920×1080): sx = 1920/1080, sy = 1080/1920.
    const clip = videoClip(0, 0) as Record<string, unknown>;
    clip.keyframes = [
      { property: "x", time: 0, value: 200, easing: "linear" },
      { property: "x", time: 2, value: -300, easing: "linear" },
      { property: "y", time: 0, value: 400, easing: "linear" },
      { property: "scale", time: 0, value: 1, easing: "linear" },
      { property: "scale", time: 2, value: 1.5, easing: "linear" },
    ];
    const comp = compWith([clip]);
    setAspectRatio(comp, { ratio: "16:9" });
    const kfs = (comp.tracks[0].clips[0] as { keyframes: { property: string; value: number }[] })
      .keyframes;
    const xKfs = kfs.filter((k) => k.property === "x");
    const yKfs = kfs.filter((k) => k.property === "y");
    const scaleKfs = kfs.filter((k) => k.property === "scale");
    expect(xKfs[0].value).toBeCloseTo(200 * (1920 / 1080), 4);
    expect(xKfs[1].value).toBeCloseTo(-300 * (1920 / 1080), 4);
    expect(yKfs[0].value).toBeCloseTo(400 * (1080 / 1920), 4);
    // scale keyframes are dimensionless — must NOT be touched.
    expect(scaleKfs[0].value).toBe(1);
    expect(scaleKfs[1].value).toBe(1.5);
  });

  it("rescales an OVERLAY clip's x/y pan KEYFRAMES (renderer composes them as px on top of the %-box)", () => {
    // The overlay renderer applies `translate(${x}px,${y}px)` from x/y keyframes
    // ON TOP of the percentage `position` box. A keyframed overlay pan is just as
    // dimension-dependent as a video pan; if the op skipped overlay clips
    // entirely the pan would keep old-canvas pixel magnitudes and drift off the
    // resized canvas. 9:16 (1080×1920) → 16:9 (1920×1080): sx=1920/1080,
    // sy=1080/1920.
    const comp = compWith([
      overlayClipWithKeyframes([
        { property: "x", time: 0, value: 300, easing: "linear" },
        { property: "x", time: 2, value: -200, easing: "linear" },
        { property: "y", time: 0, value: 500, easing: "linear" },
        { property: "scale", time: 0, value: 1, easing: "linear" },
        { property: "opacity", time: 0, value: 0.5, easing: "linear" },
      ]),
    ]);
    setAspectRatio(comp, { ratio: "16:9" });
    const clip = comp.tracks[0].clips[0] as {
      position: { xPct: number; yPct: number };
      keyframes: { property: string; value: number }[];
    };
    const xKfs = clip.keyframes.filter((k) => k.property === "x");
    const yKfs = clip.keyframes.filter((k) => k.property === "y");
    expect(xKfs[0].value).toBeCloseTo(300 * (1920 / 1080), 4);
    expect(xKfs[1].value).toBeCloseTo(-200 * (1920 / 1080), 4);
    expect(yKfs[0].value).toBeCloseTo(500 * (1080 / 1920), 4);
    // scale + opacity keyframes are dimensionless — untouched.
    expect(clip.keyframes.find((k) => k.property === "scale")!.value).toBe(1);
    expect(clip.keyframes.find((k) => k.property === "opacity")!.value).toBe(0.5);
    // The percentage placement box is resolution-independent — untouched.
    expect(clip.position.xPct).toBe(50);
    expect(clip.position.yPct).toBe(50);
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

describe("rescaleCompositionForResize (shared by applyPlatformPreset)", () => {
  it("resizes to ARBITRARY (non-canonical) dims and rescales clip offsets proportionally", () => {
    // A platform preset can carry dims that are not the canonical ASPECT_DIMS
    // (e.g. Seedance 720×1280). The single-source-of-truth rescale must work for
    // any new width/height, not just the four canonical ratios.
    const comp = compWith([videoClip(200, 400)]); // starts 1080×1920
    rescaleCompositionForResize(comp, 1080, 1920, 720, 1280);
    expect(comp.width).toBe(720);
    expect(comp.height).toBe(1280);
    const t = (comp.tracks[0].clips[0] as { transforms: { x: number; y: number } })
      .transforms;
    expect(t.x).toBeCloseTo(200 * (720 / 1080), 4);
    expect(t.y).toBeCloseTo(400 * (1280 / 1920), 4);
  });

  it("is inert when dims are unchanged (scale factors 1)", () => {
    const comp = compWith([videoClip(200, 400)]);
    rescaleCompositionForResize(comp, 1080, 1920, 1080, 1920);
    const t = (comp.tracks[0].clips[0] as { transforms: { x: number; y: number } })
      .transforms;
    expect(t.x).toBe(200);
    expect(t.y).toBe(400);
  });

  it("mutates comp IN PLACE — never replaces the comp / track / clip references", () => {
    const comp = compWith([videoClip(0, 0)]);
    const tracksRef = comp.tracks;
    const clipRef = comp.tracks[0].clips[0];
    rescaleCompositionForResize(comp, 1080, 1920, 1920, 1080);
    expect(comp.tracks).toBe(tracksRef);
    expect(comp.tracks[0].clips[0]).toBe(clipRef);
  });
});

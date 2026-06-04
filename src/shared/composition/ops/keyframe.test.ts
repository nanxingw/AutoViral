import { describe, it, expect } from "vitest";
import type { Composition, Clip, Keyframe } from "../../composition.js";
import { addKeyframe, setKeyframe } from "./keyframe.js";
import { CompositionOpError } from "./errors.js";

// S12 (US 16 / 35-37 backfill) — shared keyframe ops. Pure in-place mutators
// (ADR-009): they never replace comp / comp.tracks / a track object, never run
// CompositionSchema.parse, and throw CompositionOpError{code:4} on illegal args
// (unknown clip, text clip — D8, unknown property, negative time, speed out of
// range). The (property, time) collision math is the shared
// `addOrReplaceKeyframe` helper, so authoring via the CLI and via the Studio
// KeyframePanel converge on the same array.

function videoClip(p: {
  id: string;
  keyframes?: Keyframe[];
}): Clip {
  return {
    id: p.id,
    kind: "video",
    src: "assets/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...(p.keyframes ? { keyframes: p.keyframes } : {}),
  } as unknown as Clip;
}

function overlayClip(p: { id: string }): Clip {
  return {
    id: p.id,
    kind: "overlay",
    src: "assets/x.png",
    trackOffset: 0,
    duration: 5,
    position: { xPct: 0, yPct: 0, wPct: 50, hPct: 50 },
    opacity: 1,
  } as unknown as Clip;
}

function textClip(p: { id: string }): Clip {
  return {
    id: p.id,
    kind: "text",
    text: "hi",
    trackOffset: 0,
    duration: 5,
    style: {
      font: "Inter",
      size: 64,
      weight: 700,
      italic: false,
      tracking: 0,
      color: "#ffffff",
    },
    position: { anchor: "bottom", xPct: 50, yPct: 85 },
  } as unknown as Clip;
}

function compWith(clips: Clip[], kind: "video" | "overlay" = "video"): Composition {
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
        kind,
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

describe("@shared composition ops — addKeyframe", () => {
  it("mints the keyframes array on a clip that has none and inserts the entry in place", () => {
    const clip = videoClip({ id: "v1" });
    const comp = compWith([clip]);
    addKeyframe(comp, { clipId: "v1", property: "opacity", atSec: 0, value: 1 });
    const written = (comp.tracks[0].clips[0] as { keyframes?: Keyframe[] }).keyframes;
    expect(written).toEqual([
      { property: "opacity", time: 0, value: 1, easing: "linear" },
    ]);
    // The track / clip object identity is preserved (ADR-009 — never replaced).
    expect(comp.tracks[0].clips[0]).toBe(clip);
  });

  it("appends a second keyframe for a crossfade fade-out (sorted by time)", () => {
    const clip = videoClip({ id: "v1" });
    const comp = compWith([clip]);
    addKeyframe(comp, { clipId: "v1", property: "opacity", atSec: 5, value: 1 });
    addKeyframe(comp, { clipId: "v1", property: "opacity", atSec: 5.18, value: 0 });
    const written = (comp.tracks[0].clips[0] as { keyframes?: Keyframe[] }).keyframes!;
    expect(written.map((k) => [k.property, k.time, k.value])).toEqual([
      ["opacity", 5, 1],
      ["opacity", 5.18, 0],
    ]);
  });

  it("carries the easing through (defaults to linear when omitted)", () => {
    const clip = videoClip({ id: "v1" });
    const comp = compWith([clip]);
    addKeyframe(comp, { clipId: "v1", property: "scale", atSec: 0, value: 1, easing: "easeOut" });
    const written = (comp.tracks[0].clips[0] as { keyframes?: Keyframe[] }).keyframes!;
    expect(written[0].easing).toBe("easeOut");
  });

  it("is idempotent on a (property, time) collision — replaces, never duplicates (D4)", () => {
    const clip = videoClip({
      id: "v1",
      keyframes: [{ property: "opacity", time: 2, value: 1, easing: "linear" }],
    });
    const comp = compWith([clip]);
    addKeyframe(comp, { clipId: "v1", property: "opacity", atSec: 2, value: 0.3 });
    const written = (comp.tracks[0].clips[0] as { keyframes?: Keyframe[] }).keyframes!;
    expect(written).toHaveLength(1);
    expect(written[0].value).toBe(0.3);
  });

  it("works on an overlay clip too (opacity Ken Burns)", () => {
    const clip = overlayClip({ id: "o1" });
    const comp = compWith([clip], "overlay");
    addKeyframe(comp, { clipId: "o1", property: "opacity", atSec: 1, value: 0.5 });
    const written = (comp.tracks[0].clips[0] as { keyframes?: Keyframe[] }).keyframes!;
    expect(written[0].value).toBe(0.5);
  });

  it("throws code:4 for an unknown clip id", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    try {
      addKeyframe(comp, { clipId: "nope", property: "opacity", atSec: 0, value: 1 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionOpError);
      expect((e as CompositionOpError).code).toBe(4);
    }
  });

  it("throws code:4 for a text clip (D8 — text carries no keyframes)", () => {
    const comp = compWith([textClip({ id: "t1" })], "video");
    try {
      addKeyframe(comp, { clipId: "t1", property: "opacity", atSec: 0, value: 1 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionOpError);
      expect((e as CompositionOpError).code).toBe(4);
    }
  });

  it("throws code:4 for an unknown property (not in the keyframe enum)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    try {
      addKeyframe(comp, {
        clipId: "v1",
        property: "bogus" as never,
        atSec: 0,
        value: 1,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionOpError);
      expect((e as CompositionOpError).code).toBe(4);
    }
  });

  it("throws code:4 for a negative time", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    try {
      addKeyframe(comp, { clipId: "v1", property: "opacity", atSec: -0.5, value: 1 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionOpError);
      expect((e as CompositionOpError).code).toBe(4);
    }
  });

  it("throws code:4 for a non-finite value", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    try {
      addKeyframe(comp, { clipId: "v1", property: "opacity", atSec: 0, value: NaN });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionOpError);
      expect((e as CompositionOpError).code).toBe(4);
    }
  });

  it("throws code:4 for a speed keyframe outside [0.1, 4.0] (D10)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    try {
      addKeyframe(comp, { clipId: "v1", property: "speed", atSec: 0, value: 9 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionOpError);
      expect((e as CompositionOpError).code).toBe(4);
    }
    // A legal speed keyframe goes through.
    addKeyframe(comp, { clipId: "v1", property: "speed", atSec: 0, value: 2 });
    const written = (comp.tracks[0].clips[0] as { keyframes?: Keyframe[] }).keyframes!;
    expect(written[0].value).toBe(2);
  });

  it("throws code:4 for an unknown easing", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    try {
      addKeyframe(comp, {
        clipId: "v1",
        property: "opacity",
        atSec: 0,
        value: 1,
        easing: "wobble" as never,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionOpError);
      expect((e as CompositionOpError).code).toBe(4);
    }
  });
});

describe("@shared composition ops — setKeyframe", () => {
  it("is an idempotent set — replaces the value at an existing (property, time)", () => {
    const clip = videoClip({
      id: "v1",
      keyframes: [{ property: "scale", time: 1, value: 1, easing: "linear" }],
    });
    const comp = compWith([clip]);
    setKeyframe(comp, { clipId: "v1", property: "scale", atSec: 1, value: 1.5 });
    const written = (comp.tracks[0].clips[0] as { keyframes?: Keyframe[] }).keyframes!;
    expect(written).toHaveLength(1);
    expect(written[0].value).toBe(1.5);
  });

  it("inserts when no keyframe exists yet at (property, time)", () => {
    const clip = videoClip({ id: "v1" });
    const comp = compWith([clip]);
    setKeyframe(comp, { clipId: "v1", property: "opacity", atSec: 2, value: 0.2 });
    const written = (comp.tracks[0].clips[0] as { keyframes?: Keyframe[] }).keyframes!;
    expect(written).toEqual([
      { property: "opacity", time: 2, value: 0.2, easing: "linear" },
    ]);
  });

  it("rejects an unknown property the same way add does (code:4)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    try {
      setKeyframe(comp, { clipId: "v1", property: "nope" as never, atSec: 0, value: 1 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionOpError);
      expect((e as CompositionOpError).code).toBe(4);
    }
  });
});

import { describe, it, expect } from "vitest";
import type { Composition, Clip, Keyframe } from "../../composition.js";
import { removeKeyframe, moveKeyframe } from "./keyframe.js";
import { CompositionOpError } from "./errors.js";

// PRD-0014 S8 — shared keyframe EDIT ops (remove / move), continuing the S12
// down-sinking (add / set). Pure in-place mutators (ADR-009): never replace
// comp / comp.tracks / a track object, never run CompositionSchema.parse, throw
// CompositionOpError{code:4} on illegal args. Addressed by (property, atSec) so
// the CLI (`clip keyframe remove/move`) and the Studio KeyframePanel converge on
// the same array.

function videoClip(p: { id: string; keyframes?: Keyframe[]; out?: number }): Clip {
  return {
    id: p.id,
    kind: "video",
    src: "assets/x.mp4",
    in: 0,
    out: p.out ?? 5,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...(p.keyframes ? { keyframes: p.keyframes } : {}),
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

function kfs(comp: Composition): Keyframe[] | undefined {
  return (comp.tracks[0].clips[0] as { keyframes?: Keyframe[] }).keyframes;
}

describe("@shared composition ops — removeKeyframe", () => {
  it("removes the keyframe at (property, atSec) and keeps the rest", () => {
    const comp = compWith([
      videoClip({
        id: "v1",
        keyframes: [
          { property: "scale", time: 0, value: 1, easing: "linear" },
          { property: "scale", time: 2, value: 2, easing: "linear" },
          { property: "opacity", time: 1, value: 0.5, easing: "linear" },
        ],
      }),
    ]);
    removeKeyframe(comp, { clipId: "v1", property: "scale", atSec: 0 });
    // splice preserves the surviving entries' original order (no re-sort).
    expect(kfs(comp)).toEqual([
      { property: "scale", time: 2, value: 2, easing: "linear" },
      { property: "opacity", time: 1, value: 0.5, easing: "linear" },
    ]);
  });

  it("sets keyframes to undefined when the last entry is removed", () => {
    const comp = compWith([
      videoClip({
        id: "v1",
        keyframes: [{ property: "scale", time: 1, value: 1, easing: "linear" }],
      }),
    ]);
    removeKeyframe(comp, { clipId: "v1", property: "scale", atSec: 1 });
    expect(kfs(comp)).toBeUndefined();
  });

  it("throws code:4 when no keyframe matches (property, atSec)", () => {
    const comp = compWith([
      videoClip({
        id: "v1",
        keyframes: [{ property: "scale", time: 1, value: 1, easing: "linear" }],
      }),
    ]);
    try {
      removeKeyframe(comp, { clipId: "v1", property: "scale", atSec: 9 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CompositionOpError);
      expect((e as CompositionOpError).code).toBe(4);
    }
  });

  it("throws code:4 on an unknown clip", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    expect(() => removeKeyframe(comp, { clipId: "nope", property: "scale", atSec: 0 })).toThrow(
      CompositionOpError,
    );
  });

  it("throws code:4 on a text clip (D8)", () => {
    const comp = compWith([textClip({ id: "t1" })]);
    expect(() => removeKeyframe(comp, { clipId: "t1", property: "opacity", atSec: 0 })).toThrow(
      CompositionOpError,
    );
  });
});

describe("@shared composition ops — moveKeyframe", () => {
  it("moves the keyframe's time, leaving its value untouched", () => {
    const comp = compWith([
      videoClip({
        id: "v1",
        keyframes: [
          { property: "scale", time: 1, value: 1.5, easing: "easeIn" },
          { property: "scale", time: 3, value: 2, easing: "linear" },
        ],
      }),
    ]);
    const res = moveKeyframe(comp, { clipId: "v1", property: "scale", fromSec: 1, toSec: 2 });
    expect(res.atSec).toBeCloseTo(2, 6);
    const arr = kfs(comp)!;
    const moved = arr.find((k) => k.value === 1.5)!;
    expect(moved.time).toBeCloseTo(2, 6);
    expect(moved.value).toBe(1.5); // value unchanged
    expect(moved.easing).toBe("easeIn"); // easing unchanged
    // still sorted by time within the property
    const scales = arr.filter((k) => k.property === "scale").map((k) => k.time);
    expect(scales).toEqual([...scales].sort((a, b) => a - b));
  });

  it("clamps an out-of-bounds toSec to the clip's duration", () => {
    const comp = compWith([
      videoClip({
        id: "v1",
        out: 4, // clip duration 4s
        keyframes: [{ property: "scale", time: 1, value: 1, easing: "linear" }],
      }),
    ]);
    const res = moveKeyframe(comp, { clipId: "v1", property: "scale", fromSec: 1, toSec: 99 });
    expect(res.atSec).toBeCloseTo(4, 6);
    expect(kfs(comp)![0].time).toBeCloseTo(4, 6);
  });

  it("clamps a negative toSec to 0", () => {
    const comp = compWith([
      videoClip({
        id: "v1",
        keyframes: [{ property: "scale", time: 2, value: 1, easing: "linear" }],
      }),
    ]);
    const res = moveKeyframe(comp, { clipId: "v1", property: "scale", fromSec: 2, toSec: -3 });
    expect(res.atSec).toBe(0);
    expect(kfs(comp)![0].time).toBe(0);
  });

  it("throws code:4 when no keyframe matches (property, fromSec)", () => {
    const comp = compWith([
      videoClip({
        id: "v1",
        keyframes: [{ property: "scale", time: 1, value: 1, easing: "linear" }],
      }),
    ]);
    expect(() =>
      moveKeyframe(comp, { clipId: "v1", property: "scale", fromSec: 9, toSec: 2 }),
    ).toThrow(CompositionOpError);
  });

  it("throws code:4 on an unknown clip / text clip", () => {
    const comp = compWith([textClip({ id: "t1" }), videoClip({ id: "v1" })]);
    expect(() =>
      moveKeyframe(comp, { clipId: "nope", property: "scale", fromSec: 0, toSec: 1 }),
    ).toThrow(CompositionOpError);
    expect(() =>
      moveKeyframe(comp, { clipId: "t1", property: "opacity", fromSec: 0, toSec: 1 }),
    ).toThrow(CompositionOpError);
  });
});

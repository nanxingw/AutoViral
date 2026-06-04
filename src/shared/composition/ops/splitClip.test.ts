import { describe, it, expect, vi } from "vitest";
import type { Composition, Clip } from "../../composition.js";
import { splitClip } from "./splitClip.js";
import { CompositionOpError } from "./errors.js";

// Minimal one-track composition holding the given clips. The op is a pure
// in-place mutator so we never run CompositionSchema.parse here (decision #2).
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

function textClip(p: { id: string; trackOffset: number; duration: number }): Clip {
  return {
    id: p.id,
    kind: "text",
    text: "hi",
    trackOffset: p.trackOffset,
    duration: p.duration,
  } as unknown as Clip;
}

describe("@shared composition ops — splitClip", () => {
  it("splits a video clip in place: child A keeps id + shrinks out, child B is new + rebases in/offset", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "new-id" as `${string}-${string}-${string}-${string}-${string}`,
    );
    // clip on timeline 2..8 (clip-local [0,6]); split at timeline 5 (local 3).
    const comp = compWith([videoClip({ id: "a", trackOffset: 2, in: 0, out: 6 })]);
    const { newClipId } = splitClip(comp, { clipId: "a", atSec: 5 });
    expect(newClipId).toBe("new-id");
    const clips = comp.tracks[0].clips as Clip[];
    expect(clips.length).toBe(2);
    const sorted = [...clips].sort((x, y) => x.trackOffset - y.trackOffset);
    const [first, second] = sorted as any[];
    expect(first.id).toBe("a");
    expect(first.trackOffset).toBeCloseTo(2);
    expect(first.in).toBeCloseTo(0);
    expect(first.out).toBeCloseTo(3);
    expect(second.id).toBe("new-id");
    expect(second.trackOffset).toBeCloseTo(5);
    expect(second.in).toBeCloseTo(3);
    expect(second.out).toBeCloseTo(6);
    vi.restoreAllMocks();
  });

  it("does NOT replace the comp reference — mutates the SAME object (immer-draft safety, decision #1)", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 2, in: 0, out: 6 })]);
    const before = comp;
    const beforeTrack = comp.tracks[0];
    splitClip(comp, { clipId: "a", atSec: 5 });
    expect(comp).toBe(before);
    expect(comp.tracks[0]).toBe(beforeTrack);
  });

  it("recomputes comp.duration to the latest clip end", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 2, in: 0, out: 6 })]);
    splitClip(comp, { clipId: "a", atSec: 5 });
    expect(comp.duration).toBeCloseTo(8); // 2 + 6, unchanged total
  });

  it("splits a text clip by duration (not in/out)", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "text-2" as `${string}-${string}-${string}-${string}-${string}`,
    );
    const comp = compWith([textClip({ id: "t", trackOffset: 1, duration: 4 })]);
    splitClip(comp, { clipId: "t", atSec: 3 });
    const sorted = [...(comp.tracks[0].clips as Clip[])].sort(
      (x, y) => x.trackOffset - y.trackOffset,
    ) as any[];
    expect(sorted[0].id).toBe("t");
    expect(sorted[0].duration).toBeCloseTo(2);
    expect(sorted[1].id).toBe("text-2");
    expect(sorted[1].trackOffset).toBeCloseTo(3);
    expect(sorted[1].duration).toBeCloseTo(2);
    vi.restoreAllMocks();
  });

  it("partitions + rebases keyframes across the split (#46 parity)", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "kf-2" as `${string}-${string}-${string}-${string}-${string}`,
    );
    const clip = videoClip({ id: "a", trackOffset: 2, in: 0, out: 6 }) as any;
    clip.keyframes = [
      { property: "scale", time: 1, value: 1.2, easing: "linear" },
      { property: "scale", time: 5, value: 1.5, easing: "linear" },
    ];
    const comp = compWith([clip]);
    splitClip(comp, { clipId: "a", atSec: 5 }); // clip-local offset 3
    const [first, second] = [...(comp.tracks[0].clips as Clip[])].sort(
      (x, y) => x.trackOffset - y.trackOffset,
    ) as any[];
    expect(first.keyframes.map((k: any) => k.time)).toEqual([1, 3]);
    expect(first.keyframes.some((k: any) => k.time === 5)).toBe(false);
    expect(second.keyframes.map((k: any) => k.time)).toEqual([0, 2]);
    expect(second.keyframes.some((k: any) => k.time === 1)).toBe(false);
    vi.restoreAllMocks();
  });

  it("leaves keyframe-less clips (text) without inventing a keyframes field", () => {
    const comp = compWith([textClip({ id: "t", trackOffset: 1, duration: 4 })]);
    splitClip(comp, { clipId: "t", atSec: 3 });
    expect((comp.tracks[0].clips as Clip[]).every((c) => (c as any).keyframes === undefined)).toBe(
      true,
    );
  });

  it("gives each half its OWN nested objects — no shared aliasing (S11 patch must not bleed)", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "split-b" as `${string}-${string}-${string}-${string}-${string}`,
    );
    const clip = videoClip({ id: "a", trackOffset: 2, in: 0, out: 6 }) as any;
    clip.transforms = { scale: 1, x: 0, y: 0, rotation: 0 };
    clip.filters = { brightness: 0, contrast: 0, saturation: 0 };
    clip.style = { color: "#fff", fontSize: 48 };
    const comp = compWith([clip]);
    splitClip(comp, { clipId: "a", atSec: 5 });

    const [first, second] = [...(comp.tracks[0].clips as Clip[])].sort(
      (x, y) => x.trackOffset - y.trackOffset,
    ) as any[];

    // The nested objects must be distinct instances between the two halves.
    expect(first.transforms).not.toBe(second.transforms);
    expect(first.filters).not.toBe(second.filters);
    expect(first.style).not.toBe(second.style);

    // Behavioural proof: an IN-PLACE patch on child A (mirrors the backend
    // patchClipProps mutate-comp path) must NOT touch child B.
    first.transforms.scale = 2.5;
    first.filters.brightness = 0.9;
    first.style.color = "#000";
    expect(second.transforms.scale).toBeCloseTo(1);
    expect(second.filters.brightness).toBeCloseTo(0);
    expect(second.style.color).toBe("#fff");
    vi.restoreAllMocks();
  });

  it("throws CompositionOpError{code:4} when the clip id is unknown", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 0, in: 0, out: 4 })]);
    try {
      splitClip(comp, { clipId: "missing", atSec: 2 });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
    // unchanged
    expect(comp.tracks[0].clips.length).toBe(1);
  });

  it("throws CompositionOpError{code:4} when atSec is before the clip", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 2, in: 0, out: 6 })]);
    expect(() => splitClip(comp, { clipId: "a", atSec: 1 })).toThrow(CompositionOpError);
    expect(comp.tracks[0].clips.length).toBe(1);
  });

  it("throws CompositionOpError{code:4} when atSec is after the clip", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 2, in: 0, out: 6 })]);
    expect(() => splitClip(comp, { clipId: "a", atSec: 9 })).toThrow(CompositionOpError);
    expect(comp.tracks[0].clips.length).toBe(1);
  });

  it("throws CompositionOpError{code:4} at the exact boundary (zero-width guard)", () => {
    const comp = compWith([videoClip({ id: "a", trackOffset: 2, in: 0, out: 6 })]);
    expect(() => splitClip(comp, { clipId: "a", atSec: 2 })).toThrow(CompositionOpError);
    expect(() => splitClip(comp, { clipId: "a", atSec: 8 })).toThrow(CompositionOpError);
    expect(comp.tracks[0].clips.length).toBe(1);
  });
});

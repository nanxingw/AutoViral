import { describe, it, expect } from "vitest";
import type { Composition, Clip, Track } from "../../composition.js";
import { duplicateClip } from "./duplicateClip.js";
import { CompositionOpError } from "./errors.js";

function videoClip(id: string, trackOffset: number, dur: number): Clip {
  return {
    id,
    kind: "video",
    src: `${id}.mp4`,
    in: 0,
    out: dur,
    trackOffset,
    transforms: { scale: 1 },
    filters: {},
    keyframes: [{ property: "opacity", time: 0, value: 1, easing: "linear" }],
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
        id: "trk_v0",
        kind: "video",
        label: "V1",
        displayOrder: 0,
        volume: 0,
        muted: false,
        hidden: false,
        clips,
        transitions: [],
      } as unknown as Track,
    ],
    assets: [],
    provenance: [],
  } as unknown as Composition;
}

describe("ops.duplicateClip", () => {
  it("mints a NEW id distinct from the original", () => {
    const comp = compWith([videoClip("a", 0, 4)]);
    const { newClipId } = duplicateClip(comp, { clipId: "a" });
    expect(newClipId).not.toBe("a");
    const clips = comp.tracks[0].clips as Clip[];
    expect(clips).toHaveLength(2);
    expect(clips.filter((c) => c.id === newClipId)).toHaveLength(1);
  });

  it("places the duplicate immediately after the original by default (offset += duration)", () => {
    const comp = compWith([videoClip("a", 2, 4)]);
    const { newClipId } = duplicateClip(comp, { clipId: "a" });
    const dup = (comp.tracks[0].clips as Clip[]).find((c) => c.id === newClipId)!;
    // original at 2, duration 4 → duplicate at 6.
    expect(dup.trackOffset).toBeCloseTo(6);
  });

  it("honours an explicit --offset delta from the original's start", () => {
    const comp = compWith([videoClip("a", 2, 4)]);
    const { newClipId } = duplicateClip(comp, { clipId: "a", offsetSec: 1.5 });
    const dup = (comp.tracks[0].clips as Clip[]).find((c) => c.id === newClipId)!;
    expect(dup.trackOffset).toBeCloseTo(3.5);
  });

  it("deep-clones nested fields — mutating the clone never bleeds into the original (cloneDeep)", () => {
    const comp = compWith([videoClip("a", 0, 4)]);
    const { newClipId } = duplicateClip(comp, { clipId: "a" });
    const clips = comp.tracks[0].clips as Clip[];
    const orig = clips.find((c) => c.id === "a")! as unknown as {
      transforms: { scale: number };
      keyframes: { value: number }[];
    };
    const dup = clips.find((c) => c.id === newClipId)! as unknown as {
      transforms: { scale: number };
      keyframes: { value: number }[];
    };
    // distinct object identities
    expect(dup.transforms).not.toBe(orig.transforms);
    expect(dup.keyframes).not.toBe(orig.keyframes);
    dup.transforms.scale = 2;
    dup.keyframes[0].value = 0.5;
    expect(orig.transforms.scale).toBe(1);
    expect(orig.keyframes[0].value).toBe(1);
  });

  it("inserts the duplicate directly after the original in the clips array", () => {
    const comp = compWith([videoClip("a", 0, 2), videoClip("b", 2, 2)]);
    const { newClipId } = duplicateClip(comp, { clipId: "a" });
    const ids = (comp.tracks[0].clips as Clip[]).map((c) => c.id);
    expect(ids).toEqual(["a", newClipId, "b"]);
  });

  it("throws CompositionOpError{code:4} for an unknown clip id", () => {
    const comp = compWith([videoClip("a", 0, 4)]);
    try {
      duplicateClip(comp, { clipId: "missing" });
      expect.unreachable("duplicateClip should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("mutates comp in place — never replaces the clips array reference (ADR-009 #1)", () => {
    const comp = compWith([videoClip("a", 0, 4)]);
    const ref = comp.tracks[0].clips;
    duplicateClip(comp, { clipId: "a" });
    expect(comp.tracks[0].clips).toBe(ref);
  });
});

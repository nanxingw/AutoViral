import { describe, it, expect } from "vitest";
import type { Composition, Clip } from "../../composition.js";
import { setTransitionIn } from "./transitionIn.js";
import { CompositionOpError } from "./errors.js";

// PRD-0014 S3 — `setTransitionIn(clipId, spec|null)`. Pure in-place mutator
// (ADR-009): never replaces comp/tracks/clip references, never runs
// CompositionSchema.parse, throws CompositionOpError{code:4} on illegal args
// (unknown/non-video clip, unknown preset, durationSec > effective duration).
// spec===null clears the entrance. The store button + `autoviral clip set
// --transition-in glitch:0.4` converge on THIS one implementation.

function videoClip(p: {
  id: string;
  in?: number;
  out?: number;
  keyframes?: unknown[];
  transitionIn?: unknown;
}): Clip {
  return {
    id: p.id,
    kind: "video",
    src: "assets/x.mp4",
    in: p.in ?? 0,
    out: p.out ?? 5,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...(p.keyframes ? { keyframes: p.keyframes } : {}),
    ...(p.transitionIn ? { transitionIn: p.transitionIn } : {}),
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

describe("setTransitionIn (S3)", () => {
  it("sets a transitionIn spec on a video clip", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    setTransitionIn(comp, { clipId: "v1", spec: { preset: "glitch", durationSec: 0.4 } });
    expect(liveClip(comp, "v1").transitionIn).toEqual({ preset: "glitch", durationSec: 0.4 });
  });

  it("carries easing through when provided", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    setTransitionIn(comp, {
      clipId: "v1",
      spec: { preset: "zoom-in", durationSec: 0.5, easing: "spring" },
    });
    expect(liveClip(comp, "v1").transitionIn).toEqual({
      preset: "zoom-in",
      durationSec: 0.5,
      easing: "spring",
    });
  });

  it("defaults durationSec to the preset's registry default when omitted", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    setTransitionIn(comp, { clipId: "v1", spec: { preset: "glitch" } });
    // glitch defaultDurationSec = 0.4 (TRANSITION_PRESET_META).
    expect((liveClip(comp, "v1").transitionIn as { durationSec: number }).durationSec).toBe(0.4);
  });

  it("spec:null CLEARS an existing transitionIn", () => {
    const comp = compWith([
      videoClip({ id: "v1", transitionIn: { preset: "glitch", durationSec: 0.4 } }),
    ]);
    setTransitionIn(comp, { clipId: "v1", spec: null });
    expect(liveClip(comp, "v1").transitionIn).toBeUndefined();
  });

  it("mutates IN PLACE — clip object identity survives", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    const before = liveClip(comp, "v1");
    setTransitionIn(comp, { clipId: "v1", spec: { preset: "glitch", durationSec: 0.4 } });
    expect(liveClip(comp, "v1")).toBe(before);
  });

  it("rejects an unknown clip id (code 4)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    try {
      setTransitionIn(comp, { clipId: "nope", spec: { preset: "glitch", durationSec: 0.4 } });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionOpError);
      expect((err as CompositionOpError).code).toBe(4);
    }
  });

  it("rejects a non-video clip (code 4)", () => {
    const comp = compWith([audioClip("a1")]);
    expect(() =>
      setTransitionIn(comp, { clipId: "a1", spec: { preset: "glitch", durationSec: 0.4 } }),
    ).toThrow(CompositionOpError);
  });

  it("rejects an unknown preset (code 4)", () => {
    const comp = compWith([videoClip({ id: "v1" })]);
    expect(() =>
      setTransitionIn(comp, {
        clipId: "v1",
        spec: { preset: "no-such-preset", durationSec: 0.4 },
      }),
    ).toThrow(CompositionOpError);
  });

  it("rejects durationSec longer than the clip's effective duration (code 4)", () => {
    const comp = compWith([videoClip({ id: "v1", in: 0, out: 5 })]);
    expect(() =>
      setTransitionIn(comp, { clipId: "v1", spec: { preset: "glitch", durationSec: 6 } }),
    ).toThrow(CompositionOpError);
  });

  it("is SPEED-AWARE: a 2× clip's effective width halves, so a 3s entrance is rejected", () => {
    const comp = compWith([
      videoClip({
        id: "v1",
        in: 0,
        out: 5,
        keyframes: [
          { property: "speed", time: 0, value: 2, easing: "linear" },
          { property: "speed", time: 2, value: 2, easing: "linear" },
        ],
      }),
    ]);
    // effective = 5 / 2 = 2.5s. 3s entrance exceeds it.
    expect(() =>
      setTransitionIn(comp, { clipId: "v1", spec: { preset: "glitch", durationSec: 3 } }),
    ).toThrow(CompositionOpError);
    // 2s entrance still fits.
    setTransitionIn(comp, { clipId: "v1", spec: { preset: "glitch", durationSec: 2 } });
    expect((liveClip(comp, "v1").transitionIn as { durationSec: number }).durationSec).toBe(2);
  });

  it("a rejected set leaves the clip UNTOUCHED (atomic)", () => {
    const comp = compWith([
      videoClip({ id: "v1", transitionIn: { preset: "glitch", durationSec: 0.4 } }),
    ]);
    expect(() =>
      setTransitionIn(comp, { clipId: "v1", spec: { preset: "glitch", durationSec: 99 } }),
    ).toThrow(CompositionOpError);
    // the original entrance survives (nothing was half-written)
    expect(liveClip(comp, "v1").transitionIn).toEqual({ preset: "glitch", durationSec: 0.4 });
  });
});

import { describe, it, expect } from "vitest";
import {
  VideoClipSchema,
  CompositionWriteSchema,
  makeEmptyComposition,
  resolveSourceAudio,
} from "./composition.js";

// PRD-0014 S5 — `VideoClip.sourceAudio` + detachAudio. The schema contract:
//   - `sourceAudio?: { enabled: boolean, volume?: number }` is OPTIONAL with NO
//     top-level default, so EVERY pre-S5 work (no key) parses IDENTICALLY and
//     resolveSourceAudio() reads absent-as-{enabled:true, volume:1} (legacy
//     "the video plays its own sound" behaviour — the禁 "schema变更破坏存量 yaml").
//   - `enabled` defaults true inside the object (a partial `{volume:.5}` parses).
//   - `volume` is range-checked [0,1.5] (mirrors AudioClip.volume) — out of range
//     rejected.
//   - resolveSourceAudio is the single pure reader BOTH render sides consume.

function bareVideoClip() {
  // The exact shape an OLD work (authored before S5) carries — NO sourceAudio.
  return {
    id: "v1",
    kind: "video" as const,
    src: "assets/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
}

describe("VideoClip.sourceAudio schema (S5)", () => {
  it("a pre-S5 clip with NO sourceAudio parses unchanged (back-compat)", () => {
    const parsed = VideoClipSchema.parse(bareVideoClip());
    expect(parsed.sourceAudio).toBeUndefined();
  });

  it("resolveSourceAudio reads absent as {enabled:true, volume:1} (legacy default)", () => {
    const parsed = VideoClipSchema.parse(bareVideoClip());
    expect(resolveSourceAudio(parsed)).toEqual({ enabled: true, volume: 1 });
  });

  it("sourceAudio {enabled:false} round-trips and resolves to muted", () => {
    const parsed = VideoClipSchema.parse({
      ...bareVideoClip(),
      sourceAudio: { enabled: false },
    });
    expect(parsed.sourceAudio).toEqual({ enabled: false });
    expect(resolveSourceAudio(parsed)).toEqual({ enabled: false, volume: 1 });
  });

  it("sourceAudio.volume is carried through and resolved", () => {
    const parsed = VideoClipSchema.parse({
      ...bareVideoClip(),
      sourceAudio: { enabled: true, volume: 0.3 },
    });
    expect(resolveSourceAudio(parsed)).toEqual({ enabled: true, volume: 0.3 });
  });

  it("a partial sourceAudio {volume:0.5} defaults enabled:true", () => {
    const parsed = VideoClipSchema.parse({
      ...bareVideoClip(),
      sourceAudio: { volume: 0.5 },
    });
    expect(parsed.sourceAudio?.enabled).toBe(true);
    expect(resolveSourceAudio(parsed)).toEqual({ enabled: true, volume: 0.5 });
  });

  it("sourceAudio.volume out of range (2.0) is rejected", () => {
    const r = VideoClipSchema.safeParse({
      ...bareVideoClip(),
      sourceAudio: { enabled: true, volume: 2.0 },
    });
    expect(r.success).toBe(false);
  });

  it("sourceAudio.volume below 0 is rejected", () => {
    const r = VideoClipSchema.safeParse({
      ...bareVideoClip(),
      sourceAudio: { enabled: true, volume: -0.1 },
    });
    expect(r.success).toBe(false);
  });

  it("a full Composition carrying a sourceAudio video clip passes the STRICT write schema", () => {
    const comp = makeEmptyComposition({ workId: "w-sa" });
    const videoTrack = comp.tracks.find((t) => t.kind === "video")!;
    (videoTrack.clips as unknown[]).push({
      ...bareVideoClip(),
      sourceAudio: { enabled: false, volume: 0.8 },
    });
    const r = CompositionWriteSchema.safeParse(comp);
    expect(r.success).toBe(true);
  });
});

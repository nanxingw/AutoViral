import { describe, it, expect } from "vitest";
import {
  VideoClipSchema,
  TrackSchema,
  CompositionWriteSchema,
  makeEmptyComposition,
} from "./composition.js";

// PRD-0014 S3 — `VideoClip.transitionIn` (entrance transition). Schema contract:
//   - `transitionIn?: { preset, durationSec, easing? }` OPTIONAL with NO default,
//     so EVERY pre-S3 work (no key) parses IDENTICALLY (禁 "schema变更破坏存量 yaml").
//   - `preset` must come from the shared registry (TRANSITION_PRESETS全集, S2 交付).
//   - `durationSec` ∈ [0.05, 5] AND ≤ the clip's EFFECTIVE duration (refineTrack —
//     variable-speed aware: a sped-up clip's usable timeline width is smaller).
//   - orthogonal to a cut-point Transition (afterClipId) — coexists, never merges.

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

describe("VideoClip.transitionIn schema (S3)", () => {
  it("a pre-S3 clip with NO transitionIn parses unchanged (back-compat)", () => {
    const parsed = VideoClipSchema.parse(bareVideoClip());
    expect(parsed.transitionIn).toBeUndefined();
  });

  it("a legal transitionIn round-trips (preset + durationSec + easing)", () => {
    const parsed = VideoClipSchema.parse(
      bareVideoClip({ transitionIn: { preset: "glitch", durationSec: 0.4, easing: "spring" } }),
    );
    expect(parsed.transitionIn).toEqual({ preset: "glitch", durationSec: 0.4, easing: "spring" });
  });

  it("an unknown preset is rejected", () => {
    const r = VideoClipSchema.safeParse(
      bareVideoClip({ transitionIn: { preset: "no-such-preset", durationSec: 0.4 } }),
    );
    expect(r.success).toBe(false);
  });

  it("durationSec below the schema floor (0.01) is rejected", () => {
    const r = VideoClipSchema.safeParse(
      bareVideoClip({ transitionIn: { preset: "glitch", durationSec: 0.01 } }),
    );
    expect(r.success).toBe(false);
  });

  it("durationSec within [0.05, effective] passes the track refine", () => {
    // 5s clip, 1s entrance → fine.
    const r = TrackSchema.safeParse(
      videoTrack([bareVideoClip({ transitionIn: { preset: "glitch", durationSec: 1 } })]),
    );
    expect(r.success).toBe(true);
  });

  it("durationSec exceeding the clip's effective duration is rejected by refineTrack", () => {
    // 5s clip, 6s entrance → longer than the whole clip → reject.
    const r = TrackSchema.safeParse(
      videoTrack([bareVideoClip({ transitionIn: { preset: "glitch", durationSec: 6 } })]),
    );
    expect(r.success).toBe(false);
  });

  it("refine is SPEED-AWARE: a 2× clip has half the effective width, so a 3s entrance is rejected", () => {
    // out-in = 5, static speed 2 → effective = 2.5s. A 3s entrance exceeds it.
    const spedClip = bareVideoClip({
      transitionIn: { preset: "glitch", durationSec: 3 },
      keyframes: [
        { property: "speed", time: 0, value: 2, easing: "linear" },
        { property: "speed", time: 2, value: 2, easing: "linear" },
      ],
    });
    const r = TrackSchema.safeParse(videoTrack([spedClip]));
    expect(r.success).toBe(false);
  });

  it("a full Composition carrying a transitionIn video clip passes the STRICT write schema", () => {
    const comp = makeEmptyComposition({ workId: "w-ti" });
    const vTrack = comp.tracks.find((t) => t.kind === "video")!;
    (vTrack.clips as unknown[]).push(
      bareVideoClip({ transitionIn: { preset: "cross-dissolve", durationSec: 0.5 } }),
    );
    const r = CompositionWriteSchema.safeParse(comp);
    expect(r.success).toBe(true);
  });

  it("transitionIn coexists with a cut-point transition (orthogonal)", () => {
    const clipA = bareVideoClip({
      id: "a",
      out: 3,
      transitionIn: { preset: "zoom-in", durationSec: 0.5 },
    });
    const clipB = bareVideoClip({ id: "b", trackOffset: 3, out: 3 });
    const track = {
      ...videoTrack([clipA, clipB]),
      transitions: [
        { id: "tr1", afterClipId: "a", preset: "cross-dissolve", durationSec: 0.4, alignment: "center", easing: "linear" },
      ],
    };
    const r = TrackSchema.safeParse(track);
    expect(r.success).toBe(true);
  });
});

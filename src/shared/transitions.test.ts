import { describe, it, expect } from "vitest";
import {
  TRANSITION_PRESETS,
  TRANSITION_PRESET_META,
  getPresetMeta,
  clampHandleDuration,
} from "./transitions.js";

// #54 Phase 1 — single source of truth registry.

describe("transition preset registry (#54)", () => {
  it("every preset in the enum has metadata (registry / enum stay in lockstep)", () => {
    for (const p of TRANSITION_PRESETS) {
      expect(TRANSITION_PRESET_META[p]).toBeDefined();
      expect(TRANSITION_PRESET_META[p].defaultDurationSec).toBeGreaterThan(0);
    }
  });

  it("covers families ①②③④⑥ after Phase 2 (dissolve / wipe / slide / motion / cut)", () => {
    const families = new Set(TRANSITION_PRESETS.map((p) => getPresetMeta(p).family));
    for (const fam of ["dissolve", "wipe", "slide", "motion", "cut"] as const) {
      expect(families.has(fam)).toBe(true);
    }
  });

  it("ffmpegXfade is a string; directional families name a real xfade, motion/cut may be empty (no ffmpeg analog)", () => {
    // The field is reserved for a future ffmpeg-xfade fallback path and is NOT
    // consumed by Phase 1/2 (everything renders WYSIWYG via Remotion). flip is a
    // 3D transform and hard-cut is `none()` — neither has an xfade equivalent,
    // so an empty string is the honest value, not a placeholder lie.
    for (const p of TRANSITION_PRESETS) {
      const meta = TRANSITION_PRESET_META[p];
      expect(typeof meta.ffmpegXfade).toBe("string");
      if (meta.family === "dissolve" || meta.family === "wipe" || meta.family === "slide") {
        expect(meta.ffmpegXfade.length).toBeGreaterThan(0);
      }
    }
  });

  it("includes the Phase 2 preset additions", () => {
    for (const p of [
      "wipe-right",
      "wipe-up",
      "wipe-down",
      "clock-wipe",
      "iris",
      "push-right",
      "push-up",
      "push-down",
      "flip",
      "hard-cut",
    ] as const) {
      expect((TRANSITION_PRESETS as readonly string[]).includes(p)).toBe(true);
    }
  });
});

describe("clampHandleDuration (#54 handles)", () => {
  it("passes through when both clips have plenty of room", () => {
    expect(clampHandleDuration(0.5, 5, 5)).toBeCloseTo(0.5, 5);
  });

  it("clamps to twice the smaller clip's half-duration (no >half donation)", () => {
    // before=1s, after=3s → min=1, max half each side = 0.5 → max transition = 1s.
    expect(clampHandleDuration(2, 1, 3)).toBeCloseTo(1, 5);
  });

  it("never falls below the 0.05s schema floor (degrades visibly, not silently)", () => {
    // both clips 0 → max half = 0 → would be 0, but floored to 0.05.
    expect(clampHandleDuration(0.5, 0, 0)).toBeCloseTo(0.05, 5);
  });
});

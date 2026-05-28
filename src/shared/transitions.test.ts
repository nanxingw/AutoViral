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

  it("covers families ①②③ (dissolve / wipe / slide) at least once each", () => {
    const families = new Set(TRANSITION_PRESETS.map((p) => getPresetMeta(p).family));
    expect(families.has("dissolve")).toBe(true);
    expect(families.has("wipe")).toBe(true);
    expect(families.has("slide")).toBe(true);
  });

  it("each preset names an ffmpeg xfade transition (for Phase 2+ render parity)", () => {
    for (const p of TRANSITION_PRESETS) {
      expect(typeof TRANSITION_PRESET_META[p].ffmpegXfade).toBe("string");
      expect(TRANSITION_PRESET_META[p].ffmpegXfade.length).toBeGreaterThan(0);
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

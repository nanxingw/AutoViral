// #54 Phase 1 — single source of truth for transition presets. SHARED so
// server-side render-pipeline and client-side preview consume the SAME
// metadata; the Remotion presentation factory lives in the web layer
// (it imports from @remotion/transitions, a browser/render-time module),
// but the data model + family + default duration live here so server-side
// validation and any future ffmpeg xfade mapping stay in lockstep.
//
// Why a registry (not just an enum): the issue's core architectural risk
// is two engines drifting visually. A registry forces every consumer to
// add the same row when introducing a preset, so adding a preset to the
// schema without the matching renderer becomes a type error, not a silent
// "render-only" or "preview-only" orphan.

export const TRANSITION_PRESETS = [
  // ① dissolve
  "cross-dissolve",
  // ② wipe — directional + radial
  "wipe-left",
  "wipe-right",
  "wipe-up",
  "wipe-down",
  "clock-wipe",
  "iris",
  // ③ slide / push
  "push-left",
  "push-right",
  "push-up",
  "push-down",
  // ④ motion
  "flip",
  // ⑥ cut
  "hard-cut",
] as const;

export type TransitionPreset = (typeof TRANSITION_PRESETS)[number];

/** The 6 industry families (issue's "六大家族"). Phase 1 covers ①②③ only. */
export type TransitionFamily =
  | "dissolve"   // ① fade family
  | "wipe"       // ② clockWipe / radial / iris family
  | "slide"      // ③ push / slide / cover family
  | "motion"     // ④ whip-pan / zoom (Phase 3+)
  | "stylize"    // ⑤ light-leak / glitch / etc (Phase 2 — already orphan endpoints)
  | "cut";       // ⑥ hard cut (sentinel)

export interface TransitionPresetMeta {
  family: TransitionFamily;
  /**
   * Corresponding ffmpeg xfade name. Reserved for Phase 2+ when stylized
   * presets land — Phase 1 renders entirely via Remotion's <Scene/> (the
   * render-pipeline's "Stage 1: Remotion render" reuses the same component
   * the preview renders, so families ①②③ get WYSIWYG by construction
   * without any ffmpeg splicing).
   */
  ffmpegXfade: string;
  defaultDurationSec: number;
}

export const TRANSITION_PRESET_META: Record<TransitionPreset, TransitionPresetMeta> = {
  "cross-dissolve": { family: "dissolve", ffmpegXfade: "fade",       defaultDurationSec: 0.5 },
  "wipe-left":      { family: "wipe",     ffmpegXfade: "wipeleft",   defaultDurationSec: 0.5 },
  "wipe-right":     { family: "wipe",     ffmpegXfade: "wiperight",  defaultDurationSec: 0.5 },
  "wipe-up":        { family: "wipe",     ffmpegXfade: "wipeup",     defaultDurationSec: 0.5 },
  "wipe-down":      { family: "wipe",     ffmpegXfade: "wipedown",   defaultDurationSec: 0.5 },
  "clock-wipe":     { family: "wipe",     ffmpegXfade: "radial",     defaultDurationSec: 0.7 },
  "iris":           { family: "wipe",     ffmpegXfade: "circleopen", defaultDurationSec: 0.7 },
  "push-left":      { family: "slide",    ffmpegXfade: "slideleft",  defaultDurationSec: 0.5 },
  "push-right":     { family: "slide",    ffmpegXfade: "slideright", defaultDurationSec: 0.5 },
  "push-up":        { family: "slide",    ffmpegXfade: "slideup",    defaultDurationSec: 0.5 },
  "push-down":      { family: "slide",    ffmpegXfade: "slidedown",  defaultDurationSec: 0.5 },
  "flip":           { family: "motion",   ffmpegXfade: "",           defaultDurationSec: 0.7 },
  "hard-cut":       { family: "cut",      ffmpegXfade: "",           defaultDurationSec: 0.05 },
};

export function getPresetMeta(preset: TransitionPreset): TransitionPresetMeta {
  return TRANSITION_PRESET_META[preset];
}

/**
 * Clamp a desired transition duration to what the two adjacent clips can
 * physically afford ("handles"). A transition consumes durationSec from BOTH
 * adjacent clips; without this guard the renderer either panics or silently
 * produces a flicker. Returns the clamped duration in seconds (≥ 0.05).
 *
 * `desiredSec` = the user's intent. `clipBeforeDur`, `clipAfterDur` = the
 * usable content duration of the clips on either side of the cut. The cap is
 * the lesser of the two halved (each clip contributes half the transition).
 */
export function clampHandleDuration(
  desiredSec: number,
  clipBeforeDur: number,
  clipAfterDur: number,
): number {
  // Both halves contribute equally → each clip donates desiredSec/2. Cap so
  // neither donation exceeds half of its source duration.
  const maxHalf = Math.max(0, Math.min(clipBeforeDur, clipAfterDur) / 2);
  const cappedHalf = Math.min(desiredSec / 2, maxHalf);
  const out = cappedHalf * 2;
  return Math.max(0.05, out); // never zero — schema floor
}

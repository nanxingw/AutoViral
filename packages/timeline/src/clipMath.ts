import type { Clip } from "@shared/composition";

/**
 * Minimum allowed duration for a clip (seconds). Shared across the
 * `resizeClip` store action and the React-side `useClipResize` hook so
 * both layers clamp to the same floor — preventing zero-width clips.
 */
export const MIN_CLIP_DUR = 0.05;

/**
 * Floating-point tolerance for time comparisons (seconds). Used when
 * deciding whether two `trackOffset` values are "the same" — neighbour
 * lookup in `resizeClip`, gap detection in `collapseGaps`, and ripple
 * shift threshold in `rippleDelete`.
 */
export const OFFSET_EPSILON = 1e-6;

export function clipDuration(c: Clip): number {
  if (c.kind === "video" || c.kind === "audio") return Math.max(0, c.out - c.in);
  return Math.max(0, c.duration);
}

export function clipEnd(c: Clip): number {
  return c.trackOffset + clipDuration(c);
}

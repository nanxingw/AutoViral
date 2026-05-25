/** Pure film-grain alpha math, kept free of any `react-konva` / `konva` import
 *  so it can be unit-tested without pulling in the native `canvas` dependency.
 *  See EffectsOverlay.tsx for how this is rendered. */

/** Hard ceiling on the per-pixel noise alpha. grain=1.0 maps to this, NOT to
 *  a fully-opaque 255. Combined with the `soft-light` blend on the grain Rect,
 *  this guarantees the noise can only *modulate* the underlying composition,
 *  never replace it — fixing #36 where grain≈1.0 painted an opaque static field
 *  over the whole slide (photo + title) and baked it into the export. */
export const MAX_GRAIN_ALPHA = 0.5;

/** Map a 0..1 grain strength to a 0..255 alpha byte, capped at MAX_GRAIN_ALPHA.
 *  The invariant under test: no input — including grain=1.0 — ever yields a
 *  fully-opaque (255) pixel. */
export function grainAlpha(grain: number): number {
  const clamped = Math.min(1, Math.max(0, grain));
  return Math.round(clamped * MAX_GRAIN_ALPHA * 255);
}

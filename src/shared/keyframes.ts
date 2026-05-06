import type { Keyframe, KeyframeEasing, KeyframeProperty } from "./composition.js";

/** Time-equality tolerance for dedup at the same (property, time). ~one-quarter of a 60 fps frame. */
export const KEYFRAME_TIME_EPSILON = 1e-4;

/**
 * Pure cubic-bezier evaluation matching Remotion's `Easing.bezier(p1x,p1y,p2x,p2y)` outputs.
 * Cubic Bezier defined by (0,0), (p1x,p1y), (p2x,p2y), (1,1). Computes t for the given x via
 * Newton-Raphson, then evaluates y(t). Bisection fallback for robustness. Mirrors WebKit's impl.
 */
function bezier(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  x: number,
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;

  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;

  const sampleCurveX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleCurveY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleCurveDerivativeX = (t: number) =>
    (3 * ax * t + 2 * bx) * t + cx;

  // Newton-Raphson — converges in ~4 iterations for monotone curves.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const x2 = sampleCurveX(t) - x;
    if (Math.abs(x2) < 1e-7) return sampleCurveY(t);
    const d = sampleCurveDerivativeX(t);
    if (Math.abs(d) < 1e-7) break;
    t = t - x2 / d;
  }

  // Bisection fallback for pathological control-point configurations.
  let lo = 0;
  let hi = 1;
  t = x;
  while (lo < hi) {
    const x2 = sampleCurveX(t) - x;
    if (Math.abs(x2) < 1e-7) return sampleCurveY(t);
    if (x2 > 0) hi = t;
    else lo = t;
    const next = (hi + lo) / 2;
    if (next === t) break;
    t = next;
  }
  return sampleCurveY(t);
}

function applyEasing(easing: KeyframeEasing, t: number): number {
  switch (easing) {
    case "linear":
      return t;
    case "easeIn":
      return bezier(0.42, 0, 1, 1, t);
    case "easeOut":
      return bezier(0, 0, 0.58, 1, t);
    case "easeInOut":
      return bezier(0.42, 0, 0.58, 1, t);
  }
}

/**
 * Returns the interpolated value for `property` at clip-local time `currentTime`,
 * or `null` if the array contains no keyframe for that property.
 *
 * Contract:
 * - Out-of-range times **clamp** to the nearest endpoint (D3). No extrapolation, no wrap.
 * - The easing of the *outgoing* keyframe (segment start) controls the segment.
 * - Input order is irrelevant — internally sorts a filtered copy by `time` ASC.
 * - Volume on a VideoClip / OverlayClip is structurally allowed but renderers ignore it (D5).
 *   This helper does NOT enforce (clip × property) compatibility — that is the renderer's job.
 */
export function interpolateProperty(
  keyframes: readonly Keyframe[] | undefined,
  property: KeyframeProperty,
  currentTime: number,
): number | null {
  if (!keyframes || keyframes.length === 0) return null;
  const filtered = keyframes
    .filter((k) => k.property === property)
    .slice()
    .sort((a, b) => a.time - b.time);
  if (filtered.length === 0) return null;

  if (currentTime <= filtered[0].time) return filtered[0].value;
  const last = filtered[filtered.length - 1];
  if (currentTime >= last.time) return last.value;

  // Find the segment [a, b] containing currentTime. Linear scan is fine — a clip
  // typically has < 20 keyframes per property; binary search is overkill.
  for (let i = 0; i < filtered.length - 1; i++) {
    const a = filtered[i];
    const b = filtered[i + 1];
    if (currentTime >= a.time && currentTime <= b.time) {
      const dt = b.time - a.time;
      // Defensive: two keyframes at the same time → step to b's value.
      if (dt <= 0) return b.value;
      const tNorm = (currentTime - a.time) / dt;
      const eased = applyEasing(a.easing, tNorm);
      return a.value + (b.value - a.value) * eased;
    }
  }
  return last.value; // unreachable given the clamp branches above
}

/**
 * Idempotent insert: replaces an existing entry at `(property, time ± KEYFRAME_TIME_EPSILON)`,
 * otherwise inserts the new entry and re-sorts the array by `(property, time)`. D4 contract:
 * adding twice at the same (property, time) yields the second value, never duplicates.
 *
 * Returns a new array — never mutates the input.
 */
export function addOrReplaceKeyframe(
  keyframes: readonly Keyframe[] | undefined,
  next: Keyframe,
): Keyframe[] {
  const arr = keyframes ? keyframes.slice() : [];
  const idx = arr.findIndex(
    (k) =>
      k.property === next.property &&
      Math.abs(k.time - next.time) < KEYFRAME_TIME_EPSILON,
  );
  if (idx >= 0) {
    arr[idx] = next;
    return arr;
  }
  arr.push(next);
  arr.sort((a, b) =>
    a.property === b.property
      ? a.time - b.time
      : a.property.localeCompare(b.property),
  );
  return arr;
}

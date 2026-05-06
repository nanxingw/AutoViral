import type { Keyframe } from "./composition.js";
import { SPEED_MAX, SPEED_MIN } from "./composition.js";
import { interpolateProperty, KEYFRAME_TIME_EPSILON } from "./keyframes.js";

// Phase 8.3.A — speed-ramp pure helpers. v1 only consumes them on VideoClip
// (D1) but the helpers themselves are clip-shape-agnostic: any object with a
// `keyframes?: Keyframe[]` field works.

/**
 * Defensive runtime guard. D4 — speed values are clamped to [0.1, 4.0].
 * Non-finite inputs (NaN, +/-Infinity) collapse to the static fallback 1.0
 * so a malformed comp.yaml from an older build can't break the renderer.
 */
export function clampSpeed(v: number): number {
  if (!Number.isFinite(v)) return 1.0;
  return Math.max(SPEED_MIN, Math.min(SPEED_MAX, v));
}

/**
 * Per-frame playback rate for a VideoClip. Reads the "speed" keyframes (if
 * any) via interpolateProperty and falls back to 1.0 (D3). Output is clamped
 * to [SPEED_MIN, SPEED_MAX] (D4). Pure — no Remotion hooks; the renderer
 * passes `useCurrentFrame()` and `useVideoConfig().fps` as args.
 */
export function computeVideoSpeedForFrame(
  clip: { keyframes?: readonly Keyframe[] },
  localFrame: number,
  fps: number,
): number {
  if (!Number.isFinite(fps) || fps <= 0) return 1.0;
  const localSec = localFrame / fps;
  const v = interpolateProperty(clip.keyframes, "speed", localSec);
  return clampSpeed(v ?? 1.0);
}

/**
 * Returns the agreed-upon speed value if every speed keyframe on the clip
 * has the same value (within KEYFRAME_TIME_EPSILON), otherwise null. Null
 * also means "no speed keyframes" — the caller treats null as "static 1.0".
 *
 * Used by the export pipeline (D6) to decide between fast-path ffmpeg
 * setpts and the deferred variable-speed path.
 */
export function isStaticSpeed(clip: {
  keyframes?: readonly Keyframe[];
}): number | null {
  const speedKfs = (clip.keyframes ?? []).filter(
    (k) => k.property === "speed",
  );
  if (speedKfs.length === 0) return null;
  const first = speedKfs[0].value;
  for (const k of speedKfs) {
    if (Math.abs(k.value - first) > KEYFRAME_TIME_EPSILON) return null;
  }
  return clampSpeed(first);
}

/**
 * Timeline width (in seconds) of a clip, accounting for speed ramps (D7).
 *
 * Convention (D9): keyframe `time` values are clip-local *timeline* seconds.
 * For static speed=k, width = (out - in) / k. For variable speed, we sample
 * the speed curve at 0.01s steps along timeline-time, accumulating consumed
 * source-time; the timeline-time at which we have consumed (out - in)
 * seconds of source IS the effective clip duration.
 *
 * Speed > 1 SHRINKS timeline duration; speed < 1 EXPANDS it (D9).
 */
export function effectiveClipDuration(clip: {
  in: number;
  out: number;
  keyframes?: readonly Keyframe[];
}): number {
  const sourceDur = clip.out - clip.in;
  if (sourceDur <= 0) return 0;

  const stat = isStaticSpeed(clip);
  if (stat !== null) return sourceDur / stat;

  const hasSpeedKfs = (clip.keyframes ?? []).some(
    (k) => k.property === "speed",
  );
  if (!hasSpeedKfs) return sourceDur;

  const dt = 0.01; // 100 Hz sampling — fine for any real curve
  let timelineT = 0;
  let consumed = 0;
  // Cap the sampling loop to a generous upper bound to prevent runaway loops
  // on pathological inputs (e.g. all keyframes clamped near SPEED_MIN).
  const MAX_TIMELINE_T = sourceDur / SPEED_MIN + 1;
  while (consumed < sourceDur && timelineT < MAX_TIMELINE_T) {
    const speed = clampSpeed(
      interpolateProperty(clip.keyframes, "speed", timelineT) ?? 1.0,
    );
    const stepConsumed = speed * dt;
    if (consumed + stepConsumed >= sourceDur) {
      // Linear interpolation within the final step for sub-step accuracy.
      const remaining = sourceDur - consumed;
      timelineT += remaining / speed;
      return timelineT;
    }
    consumed += stepConsumed;
    timelineT += dt;
  }
  return timelineT;
}

// S1 (PRD-0012) — jitter-scan pure core.
//
// Detects the "backward jump" (跳回前几帧) signature that
// docs/issues/026-export-backward-frame-jitter.md found burned into exported
// mp4s: a frame whose diff vs the immediately-PRECEDING frame is large (the
// picture is visibly moving) yet whose diff vs one of the previous k∈[2,12]
// frames is near-zero (playback decoded/seeked BACKWARD to an earlier frame,
// then continued forward from there — a "跳回前几帧" rewind).
//
// This is a straight port of the reference implementation embedded in
// docs/issues/026 (lines 26-50), which was validated against real exports
// (37 events / 106s clip) and a clean source (0 events). It operates on an
// abstract sequence of equal-length grayscale intensity frames — the caller
// (scripts/jitter-scan.mjs) is responsible for producing those frames from an
// mp4 via ffmpeg's `scale=32:18,format=gray` rawvideo dump; this module has no
// ffmpeg/fs dependency so it stays unit-testable with synthetic frames.

/** One detected backward-jump event. */
export interface BackwardJumpEvent {
  /** Frame index (0-based) at which the jump was detected. */
  t: number;
  /** How many frames back the jump landed on (2-12). */
  k: number;
  /** `t` converted to seconds via the supplied fps, rounded to 2dp. */
  sec: number;
}

export interface ScanBackwardJumpsOptions {
  /**
   * Frames 2..maxK back are searched for a near-duplicate match. Reference
   * default: 12 (empirically covers ~1s of GOP-anchored rewind at 24fps).
   */
  maxK?: number;
  /**
   * Mean-absolute-difference below this counts as "near-duplicate" (i.e. the
   * same underlying source frame). Reference default: 0.6.
   */
  dupThreshold?: number;
  /**
   * Floor for the "is this frame actually moving" threshold — the adaptive
   * threshold (median of all adjacent-frame diffs) is clamped to be at least
   * this, so a mostly-static clip with a handful of genuinely-still frames
   * doesn't get a near-zero median that flags noise as motion. Reference
   * default: 1.5.
   */
  movingFloor?: number;
}

const DEFAULT_MAX_K = 12;
const DEFAULT_DUP_THRESHOLD = 0.6;
const DEFAULT_MOVING_FLOOR = 1.5;

/** Mean absolute difference between two equal-length grayscale frames. */
function mad(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    sum += Math.abs(a[i]! - b[i]!);
  }
  return len > 0 ? sum / len : 0;
}

/** The p-th quantile (0..1) of an already-sorted numeric array. */
function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx]!;
}

/**
 * Scan a sequence of grayscale frames for backward-jump events.
 *
 * Algorithm (mirrors docs/issues/026 reference exactly):
 *   1. compute the adjacent-frame diff (mad(frame[t], frame[t-1])) for every
 *      t in [1, n).
 *   2. the "is this frame moving" threshold is `max(movingFloor,
 *      median(adjacent diffs))` — adaptive to the clip's own motion level.
 *   3. for every t in [2, n) where the adjacent diff exceeds that threshold
 *      (the picture visibly moved), search k in [2, min(maxK, t)] for the
 *      first frame[t-k] that's a near-duplicate of frame[t] (mad < dupThreshold).
 *      A match means frame t is NOT a continuation of frame t-1 — it's a
 *      rewind back to frame t-k.
 */
export function scanBackwardJumps(
  frames: readonly Uint8Array[],
  fps: number,
  opts: ScanBackwardJumpsOptions = {},
): BackwardJumpEvent[] {
  const n = frames.length;
  if (n < 3) return [];

  const maxK = opts.maxK ?? DEFAULT_MAX_K;
  const dupThreshold = opts.dupThreshold ?? DEFAULT_DUP_THRESHOLD;
  const movingFloor = opts.movingFloor ?? DEFAULT_MOVING_FLOOR;

  const adjacentDiffs: number[] = [];
  for (let t = 1; t < n; t++) {
    adjacentDiffs.push(mad(frames[t]!, frames[t - 1]!));
  }
  const sorted = [...adjacentDiffs].sort((a, b) => a - b);
  const movingThreshold = Math.max(movingFloor, quantile(sorted, 0.5));

  const events: BackwardJumpEvent[] = [];
  for (let t = 2; t < n; t++) {
    const d1 = mad(frames[t]!, frames[t - 1]!);
    if (d1 <= movingThreshold) continue;
    const kLimit = Math.min(maxK, t);
    for (let k = 2; k <= kLimit; k++) {
      if (mad(frames[t]!, frames[t - k]!) < dupThreshold) {
        events.push({ t, k, sec: Number((t / fps).toFixed(2)) });
        break;
      }
    }
  }
  return events;
}

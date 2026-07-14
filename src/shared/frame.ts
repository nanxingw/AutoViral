// PRD-0014 S15 — `snapToFrame`: the SINGLE shared frame-quantiser for the
// composition-ops layer. Every op that writes a timeline offset / source window
// (in/out) / durationSec / keyframe-time from a caller-supplied value routes it
// through here at its entry, so an agent's `--at 1.23456` and a human's timeline
// drag both land on a whole-frame boundary. This kills the sub-frame drift that
//累积 across repeated trim/split and produced the #026/#027 export jitter.
//
// It is ALSO the one place `Math.round(sec * fps) / fps` lives: the S4 speed-ramp
// segment boundaries (server/speed-ramp-ffmpeg.ts) and the S8 reframe punch-in
// snap clamp (ops/reframeClip.ts) are consolidated onto this helper — there is no
// second (or third) copy of the arithmetic to drift out of lockstep.
//
// Rejections are typed CompositionOpError{code:4} so the bridge/CLI write path
// surfaces them as a clean 400 + exit-4 (the same envelope every other op
// rejection uses), never a naked render crash.

import { CompositionOpError } from "./composition/ops/errors.js";

/**
 * Round `sec` to the nearest whole-frame boundary at `fps`.
 *
 * `snapToFrame(0.034, 30)` → `1/30` (0.034s = 1.02 frames → frame 1).
 *
 * Throws `CompositionOpError{code:4}` when:
 *  - `fps` is not a finite positive number, or
 *  - `sec` is not a finite number, or
 *  - `sec` is negative (a timeline position / duration is always ≥ 0; callers
 *    that legitimately clamp a negative input to 0 must do so BEFORE calling).
 */
export function snapToFrame(sec: number, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new CompositionOpError(
      `snapToFrame: fps ${String(fps)} must be a finite positive number`,
      4,
    );
  }
  if (!Number.isFinite(sec)) {
    throw new CompositionOpError(
      `snapToFrame: sec ${String(sec)} must be a finite number`,
      4,
    );
  }
  if (sec < 0) {
    throw new CompositionOpError(
      `snapToFrame: sec ${sec} must be ≥ 0 (clamp negative inputs to 0 before snapping)`,
      4,
    );
  }
  return Math.round(sec * fps) / fps;
}

/**
 * Round `sec` DOWN to the largest whole-frame boundary ≤ `sec` at `fps`.
 *
 * Used where snapping UP would push a value past an upper bound and self-reject:
 * a keyframe authored AT a fractional-frame clip end (S15 finding 3) must land on
 * a whole frame WITHIN the clip's own span, and a transition's auto-fit default
 * must not grow past the clip's effective width. `snapToFrame` (round-to-nearest)
 * can overshoot; `frameFloor` cannot.
 */
export function frameFloor(sec: number, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new CompositionOpError(
      `frameFloor: fps ${String(fps)} must be a finite positive number`,
      4,
    );
  }
  if (!Number.isFinite(sec) || sec < 0) {
    throw new CompositionOpError(
      `frameFloor: sec ${String(sec)} must be a finite number ≥ 0`,
      4,
    );
  }
  // +1e-9 tolerance so a value already on a boundary (15.0 frames) floors to
  // itself despite binary-float error, not to the frame below it.
  return Math.floor(sec * fps + 1e-9) / fps;
}

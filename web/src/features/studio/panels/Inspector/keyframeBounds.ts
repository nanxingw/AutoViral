import type { Clip } from "../../types";

// #40 — keyframe TIME bounds. KeyframeSchema declares `time: z.number().min(0)`
// (clip-local seconds) with NO upper bound, so the Inspector happily accepted
// t=99999 on a 4s clip and persisted it, corrupting the animation curve. The
// upper bound is the clip's own duration, which is represented differently per
// kind: video/audio carry in/out points; overlay carries an explicit duration;
// text clips have no keyframes (the panel returns early for them).

/** Upper bound for a keyframe's clip-local time, in seconds. */
export function clipKeyframeDuration(clip: Clip): number {
  if (clip.kind === "video" || clip.kind === "audio") {
    return Math.max(0, clip.out - clip.in);
  }
  if (clip.kind === "overlay") return Math.max(0, clip.duration);
  return 0; // text clips don't support keyframes
}

/** Clamp a keyframe time into [0, clipDuration]. Non-finite input → 0. */
export function clampKeyframeTime(time: number, clip: Clip): number {
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.min(time, clipKeyframeDuration(clip)));
}

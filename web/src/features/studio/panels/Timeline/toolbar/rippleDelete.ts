import type { Track, Clip } from "../../../types";
import { clipDuration, OFFSET_EPSILON } from "../clipMath";

/**
 * Ripple-delete a clip from a track: remove it, and shift every later clip
 * on the same track left by the removed clip's duration so the downstream
 * content closes up. Earlier clips are left untouched.
 *
 * Pure: returns a new Track (and new clip objects for the ones that moved).
 * If `clipId` is not present on the track, the original track is returned
 * by reference so callers can use referential equality as a no-op probe.
 *
 * Adapted from pneuma's `buildRippleDeleteCommands`
 * (.cache/pneuma-clipcraft/.../toolbar/rippleDelete.ts:14-40).
 * Pneuma emits a `remove-clip` + N `move-clip` command list; we mutate
 * a single `Track` immutably because our store carries authoritative
 * `Clip` objects (D3: clip duration via `clipDuration` from clipMath.ts,
 * not inline `out - in`).
 */
export function rippleDeleteFromTrack(track: Track, clipId: string): Track {
  const idx = track.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) return track;
  const removed = track.clips[idx];
  const removedDur = clipDuration(removed);
  const removedStart = removed.trackOffset;
  const newClips = track.clips
    .filter((c) => c.id !== clipId)
    .map((c) =>
      c.trackOffset > removedStart + OFFSET_EPSILON
        ? ({ ...c, trackOffset: Math.max(0, c.trackOffset - removedDur) } as Clip)
        : c,
    );
  return { ...track, clips: newClips as Track["clips"] };
}

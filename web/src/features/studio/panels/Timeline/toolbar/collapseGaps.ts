import type { Track, Clip } from "../../../types";
import { clipDuration, OFFSET_EPSILON } from "@autoviral/timeline";

/**
 * Repack a track's clips back-to-back from `trackOffset = 0`, in
 * ascending-startTime order, so all gaps between clips collapse.
 *
 * Pure: returns a new Track. Master plan §4.1 lines 2282-2291 inlines this
 * as the canonical reference; it's also a near-verbatim port of pneuma's
 * `buildCollapseGapsCommands`
 * (.cache/pneuma-clipcraft/.../toolbar/collapseGaps.ts:11-30) — pneuma
 * walks sorted clips and emits `move-clip` commands when a clip's start
 * doesn't match the running cursor; we emit fresh Clip objects instead
 * (D3: clip duration via `clipDuration` from clipMath.ts).
 */
export function collapseGapsOnTrack(track: Track): Track {
  let cursor = 0;
  const newClips = track.clips
    .slice()
    .sort((a, b) => a.trackOffset - b.trackOffset)
    .map((c) => {
      let next: Clip = c;
      if (Math.abs(c.trackOffset - cursor) > OFFSET_EPSILON) {
        next = { ...c, trackOffset: cursor } as Clip;
      }
      cursor += clipDuration(next);
      return next;
    });
  return { ...track, clips: newClips as Track["clips"] };
}

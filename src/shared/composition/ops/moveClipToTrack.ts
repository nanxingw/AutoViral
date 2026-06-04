// ADR-009 (S8) — `moveClipToTrack`: relocate a clip from its current lane to
// another lane of the SAME kind, lifted into the shared composition-ops core.
// The studio store's Inspector lane-select + native-DnD path and the bridge
// read-modify-write path consume THIS one implementation, so an agent moving a
// clip via the CLI (`autoviral clip move <id> --to-track <trackId>`) and a human
// dragging it to another lane in the UI converge on the same composition.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — never replace `comp`,
// `comp.tracks`, or `comp.tracks[i]` with a fresh object (that breaks the immer
// draft proxy on the store side). We detach the EXISTING clip object from the
// source track's `clips` array and push it onto the target track's `clips`
// array via in-place `splice` / `push`, so both arrays keep their identity. No
// fs / http here, and no CompositionSchema.parse (the bridge chokepoint
// validates on write; the store validates at its existing moments). Illegal
// params throw CompositionOpError{code:4}.

import type { Composition, Clip, Track } from "../../composition.js";
import { CompositionOpError } from "./errors.js";

/**
 * Move the clip `clipId` to the track `targetTrackId`, preserving its
 * `trackOffset` (timeline position) — the clip stays at the same horizontal
 * spot, just on a new lane. The target track MUST be the same `kind` as the
 * source track (a clip only belongs on a track of its own kind; the source
 * track kind is authoritative because the clip was validly placed there).
 *
 * Side-effect: removing the clip from the source track can orphan a transition
 * there in TWO ways, and BOTH must be pruned or the next CompositionSchema.parse()
 * (autosave 400 / save round-trip) fails the Track superRefine:
 *   (a) the moved clip was the transition anchor (`afterClipId === clipId`) — its
 *       afterClipId no longer matches any clip on the track; OR
 *   (b) the clip's departure makes a *different*, surviving clip the new LAST clip
 *       of the source track, and a transition is pinned to that now-last clip
 *       (`afterClipId === newLastClipId`). The superRefine rejects a transition
 *       pinned to the last clip because it has no successor to fade INTO.
 * We PRUNE both in place so the composition stays parseable (mirrors the store's
 * removeClip / commitDrag pruning, which share this same family bug).
 *
 * Throws `CompositionOpError{code:4}` when:
 *  - no clip matches `clipId`, or
 *  - no track matches `targetTrackId`, or
 *  - the target track is a different `kind` than the source track.
 *
 * A move to the SAME track the clip already lives on is a no-op (returns
 * without throwing) — there is nothing to relocate.
 */
export function moveClipToTrack(
  comp: Composition,
  p: { clipId: string; targetTrackId: string },
): void {
  const { clipId, targetTrackId } = p;

  // Locate the clip + the track it currently lives on.
  let sourceTrack: Track | undefined;
  let clipIdx = -1;
  for (const tr of comp.tracks) {
    const idx = (tr.clips as Clip[]).findIndex((c) => c.id === clipId);
    if (idx >= 0) {
      sourceTrack = tr;
      clipIdx = idx;
      break;
    }
  }
  if (!sourceTrack || clipIdx < 0) {
    throw new CompositionOpError(`moveClipToTrack: no clip with id ${clipId}`, 4);
  }

  const target = comp.tracks.find((t) => t.id === targetTrackId);
  if (!target) {
    throw new CompositionOpError(
      `moveClipToTrack: no track with id ${targetTrackId}`,
      4,
    );
  }

  // Already there → nothing to do (idempotent, not an error).
  if (target.id === sourceTrack.id) return;

  // Kind guard: a clip only belongs on a track of its own kind. The source
  // track kind is authoritative (the clip was validly placed there).
  if (target.kind !== sourceTrack.kind) {
    throw new CompositionOpError(
      `moveClipToTrack: cannot move a ${sourceTrack.kind} clip to a ${target.kind} track`,
      4,
    );
  }

  // Detach from source, attach to target — trackOffset (time) is kept, so the
  // clip stays at the same horizontal position, just on a new lane. We splice
  // the EXISTING clip object out of the source `clips` array and push it onto
  // the target `clips` array; both arrays keep their identity (decision #1).
  const [clip] = (sourceTrack.clips as Clip[]).splice(clipIdx, 1);
  (target.clips as Clip[]).push(clip);

  // #54 / S8 — prune transitions the move just orphaned on the source track, in
  // place (filter back onto the SAME array reference) — mirrors removeClip. Two
  // conditions, not one:
  //  (a) afterClipId === the MOVED clip — its anchor left the track; and
  //  (b) afterClipId === the now-LAST clip on the source track — that clip has no
  //      successor after the splice, so a transition pinned to it has nothing to
  //      fade INTO and the Track superRefine rejects it on the next parse.
  // Both must go or writeCompositionFor's CompositionWriteSchema.parse throws a
  // 400 on a VALID move (the exact autosave-400 failure mode this prune exists
  // to prevent). newLastClipId is read AFTER the splice (the moved clip is gone).
  if (sourceTrack.transitions && sourceTrack.transitions.length > 0) {
    const srcClips = sourceTrack.clips as Clip[];
    const newLastClipId = srcClips[srcClips.length - 1]?.id;
    const kept = sourceTrack.transitions.filter(
      (tr) =>
        tr.afterClipId !== clipId && tr.afterClipId !== newLastClipId,
    );
    sourceTrack.transitions.length = 0;
    sourceTrack.transitions.push(...kept);
  }
}

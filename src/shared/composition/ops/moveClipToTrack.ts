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
 * Side-effect: if the moved clip was the anchor of a transition on the SOURCE
 * track (`transition.afterClipId === clipId`), that transition is orphaned once
 * the clip leaves — its `afterClipId` no longer matches any clip on the track,
 * which the Track superRefine rejects on the next CompositionSchema.parse()
 * (autosave 400 / save round-trip). We PRUNE such transitions in place so the
 * composition stays parseable (mirrors the store's removeClip pruning).
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

  // #54 — the moved clip may have anchored a transition on the source track;
  // once it leaves, that transition's afterClipId is orphaned and the Track
  // superRefine would reject the next CompositionSchema.parse(). Prune those in
  // place (filter back onto the SAME array reference) — mirrors removeClip.
  if (sourceTrack.transitions && sourceTrack.transitions.length > 0) {
    const kept = sourceTrack.transitions.filter(
      (tr) => tr.afterClipId !== clipId,
    );
    sourceTrack.transitions.length = 0;
    sourceTrack.transitions.push(...kept);
  }
}

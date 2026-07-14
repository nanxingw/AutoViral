// ADR-009 (PRD-0014 S7) — `rippleDeleteClip`: remove a clip AND close the gap it
// leaves by sliding every LATER clip on the same track left by the removed
// clip's duration. Lifted into the shared composition-ops core so the studio
// store's Shift+Backspace ripple-delete and the bridge/CLI (`autoviral clip
// remove --ripple`) consume THIS one implementation — an agent rippling a beat
// out via the CLI and a human doing it in the UI converge byte-for-byte.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — splice/patch the EXISTING
// `clips` array so it keeps its identity (never replace the array or the track
// object; that breaks the immer draft proxy on the store side). No fs / http and
// no CompositionSchema.parse (the bridge chokepoint validates on write, the
// store at its existing moments).
//
// Behaviour is a faithful port of the web toolbar helper `rippleDeleteFromTrack`
// (panels/Timeline/toolbar/rippleDelete.ts, itself a port of pneuma's
// buildRippleDeleteCommands): shift ONLY clips whose start is strictly after the
// removed clip's start, by the removed clip's duration, clamped at 0. Earlier
// clips are untouched. Unknown id is a no-op (`removed:false`), never a throw —
// the store keeps its silent-no-op contract; the route decides whether to 400.

import type { Composition, Clip } from "../../composition.js";
import { snapToFrame } from "../../frame.js";

// Floating-point tolerance for the "strictly after" boundary. Mirrors the
// timeline package's OFFSET_EPSILON; inlined so the op stays free of the
// web-only `@autoviral/timeline` package (which imports @shared → a cycle).
const OFFSET_EPSILON = 1e-6;

function clipDuration(c: Clip): number {
  if (c.kind === "video" || c.kind === "audio") return Math.max(0, c.out - c.in);
  return Math.max(0, (c as { duration: number }).duration);
}

function clipEnd(c: Clip): number {
  return c.trackOffset + clipDuration(c);
}

function recomputeDuration(comp: Composition): void {
  comp.duration = Math.max(
    0,
    ...comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
  );
}

/**
 * Ripple-delete the clip `clipId` from whichever track holds it. Returns
 * `{ removed }` — `false` (no-op) when no track holds the clip. On success
 * `comp.duration` is recomputed to the new content end.
 */
export function rippleDeleteClip(
  comp: Composition,
  p: { clipId: string },
): { removed: boolean } {
  for (const track of comp.tracks) {
    const clips = track.clips as Clip[];
    const idx = clips.findIndex((c) => c.id === p.clipId);
    if (idx < 0) continue;

    const removed = clips[idx];
    const removedDur = clipDuration(removed);
    const removedStart = removed.trackOffset;

    // Remove in place (keeps the array reference — decision #1).
    clips.splice(idx, 1);
    // Slide every clip that STARTED after the removed clip left by its duration.
    // S15 finding 2 — snap the DERIVED offset to a whole frame: if `removedDur`
    // carried any sub-frame residue, the slid offset would land off-grid; snapping
    // the result keeps the whole track frame-aligned (a no-op when inputs already are).
    for (const c of clips) {
      if (c.trackOffset > removedStart + OFFSET_EPSILON) {
        c.trackOffset = snapToFrame(Math.max(0, c.trackOffset - removedDur), comp.fps);
      }
    }

    // #54 / S8 — drop transitions the ripple-delete just invalidated, in place
    // (filter back onto the SAME array reference) — mirrors ops.moveClipToTrack
    // and store.removeClip. TWO conditions, not one:
    //  (a) afterClipId === the REMOVED clip — its anchor left the track; and
    //  (b) afterClipId === the now-LAST clip — after the splice that clip has no
    //      successor, so a transition pinned to it has nothing to fade INTO and
    //      the Track superRefine rejects it on the next parse.
    // Without this, writeCompositionFor's CompositionWriteSchema.parse throws a
    // 400 on a VALID ripple of a work carrying transitions (bridge/CLI path), and
    // the store keeps an unwriteable composition in memory (UI path). newLastId is
    // read AFTER the splice (the removed clip is gone).
    const trackWithTransitions = track as {
      transitions?: { afterClipId: string }[];
    };
    if (trackWithTransitions.transitions && trackWithTransitions.transitions.length > 0) {
      const newLastId = clips[clips.length - 1]?.id;
      const kept = trackWithTransitions.transitions.filter(
        (tr) => tr.afterClipId !== p.clipId && tr.afterClipId !== newLastId,
      );
      trackWithTransitions.transitions.length = 0;
      trackWithTransitions.transitions.push(...kept);
    }

    recomputeDuration(comp);
    return { removed: true };
  }
  return { removed: false };
}

// Re-exported type nicety so callers can name the return shape.
export type RippleDeleteResult = ReturnType<typeof rippleDeleteClip>;

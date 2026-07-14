// ADR-009 (PRD-0014 S7) — `collapseGapsOnTrack`: repack a track's clips
// back-to-back from `trackOffset = 0`, in ascending-start order, so every gap
// between clips closes. Lifted into the shared composition-ops core so the
// studio store's collapse-gaps toolbar action and the bridge/CLI (`autoviral
// track collapse <id>`) consume THIS one implementation.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE. We `Array.prototype.sort`
// the EXISTING `clips` array (mutates in place, keeps the array reference) and
// then reassign each clip's `trackOffset` on the EXISTING clip objects — never
// replace the array or the track object (that breaks the immer draft proxy).
//
// Behaviour mirrors the web toolbar helper `collapseGapsOnTrack`
// (panels/Timeline/toolbar/collapseGaps.ts, a port of pneuma's
// buildCollapseGapsCommands): walk clips sorted by start, place each at the
// running cursor, advance the cursor by its duration. Returns `{ found, moved }`
// — `found:false` for an unknown track (a no-op, never a throw: the store keeps
// its silent-no-op contract, the route decides whether to 400); `moved` is true
// iff any clip's order or offset actually changed (lets the store skip a
// redundant undo snapshot). On a real move `comp.duration` is recomputed.

import type { Composition, Clip } from "../../composition.js";
import { snapToFrame } from "../../frame.js";

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

export function collapseGapsOnTrack(
  comp: Composition,
  p: { trackId: string },
): { found: boolean; moved: boolean } {
  const track = comp.tracks.find((t) => t.id === p.trackId);
  if (!track) return { found: false, moved: false };

  const clips = track.clips as Clip[];
  // Fingerprint the pre-collapse ordering so we can report a reorder even when
  // no offset shifts (an out-of-order-but-tight track still "moved").
  const beforeOrder = clips.map((c) => c.id).join("|");

  // Sort in place (keeps the array reference — decision #1).
  clips.sort((a, b) => a.trackOffset - b.trackOffset);

  let cursor = 0;
  // A reorder counts as a move; so does any offset adjustment in the walk below.
  let moved = clips.map((c) => c.id).join("|") !== beforeOrder;
  for (const c of clips) {
    // S15 finding 2 — place each clip at the running cursor SNAPPED to a whole
    // frame: a sub-frame clip duration would otherwise let repacked offsets drift
    // off-grid (a no-op when every duration is already frame-aligned).
    const placed = snapToFrame(Math.max(0, cursor), comp.fps);
    if (Math.abs(c.trackOffset - placed) > OFFSET_EPSILON) {
      c.trackOffset = placed;
      moved = true;
    }
    cursor += clipDuration(c);
  }

  if (moved) recomputeDuration(comp);
  return { found: true, moved };
}

export type CollapseGapsResult = ReturnType<typeof collapseGapsOnTrack>;

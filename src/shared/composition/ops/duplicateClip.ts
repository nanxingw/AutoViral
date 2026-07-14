// ADR-009 (PRD-0014 S7) — `duplicateClip`: deep-copy a clip, mint a fresh id,
// and drop the copy onto the SAME track immediately after the original (or at an
// explicit `--offset` delta from the original's start). Lifted into the shared
// composition-ops core so a future studio "duplicate" affordance and the
// bridge/CLI (`autoviral clip duplicate <id> [--offset]`) share one
// implementation.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — `splice` the copy into the
// EXISTING `clips` array so it keeps its identity. No fs / http and no
// CompositionSchema.parse. Illegal params (unknown clip) throw
// CompositionOpError{code:4}.
//
// cloneDeep (NOT structuredClone, which rejects immer draft Proxies with
// DataCloneError) gives the copy its OWN nested objects (transforms / filters /
// keyframes / style / position) so a later in-place patch on one can't bleed
// into the other — the #81/#86 spread-bleed lesson at the whole-clip scale.

import type { Composition, Clip } from "../../composition.js";
import { snapToFrame } from "../../frame.js";
import { CompositionOpError } from "./errors.js";

function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => cloneDeep(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object)) {
      out[k] = cloneDeep((value as Record<string, unknown>)[k]);
    }
    return out as T;
  }
  return value;
}

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
 * Duplicate the clip `clipId`. The copy gets a freshly-minted `crypto.randomUUID`
 * id and lands on the same track directly after the original in the array. Its
 * `trackOffset` = original.trackOffset + (`offsetSec` when given, else the
 * original's duration — i.e. back-to-back placement). Returns the new clip id.
 *
 * Throws `CompositionOpError{code:4}` when no clip matches `clipId`.
 */
export function duplicateClip(
  comp: Composition,
  p: { clipId: string; offsetSec?: number },
): { newClipId: string } {
  for (const track of comp.tracks) {
    const clips = track.clips as Clip[];
    const idx = clips.findIndex((c) => c.id === p.clipId);
    if (idx < 0) continue;

    const orig = clips[idx];
    const copy = cloneDeep(orig);
    const newClipId = crypto.randomUUID();
    (copy as { id: string }).id = newClipId;

    const delta =
      p.offsetSec !== undefined && Number.isFinite(p.offsetSec)
        ? p.offsetSec
        : clipDuration(orig);
    // S15 — snap the resulting timeline offset to a whole frame (the copy's
    // placement is a caller-supplied delta from the original's start).
    (copy as { trackOffset: number }).trackOffset = snapToFrame(
      Math.max(0, orig.trackOffset + delta),
      comp.fps,
    );

    // Insert directly after the original — keeps the array reference (#1).
    clips.splice(idx + 1, 0, copy);
    recomputeDuration(comp);
    return { newClipId };
  }
  throw new CompositionOpError(
    `duplicateClip: no clip with id ${p.clipId}`,
    4,
  );
}

export type DuplicateClipResult = ReturnType<typeof duplicateClip>;

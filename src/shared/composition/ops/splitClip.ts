// ADR-009 — `splitClip`: the first intent-level mutation lifted into the
// shared composition-ops core. Both the frontend studio store (immer draft)
// and the backend bridge (read-modify-write a parsed object) consume THIS one
// implementation, so the split invariants (keyframe rebase, child-id mint,
// duration recompute) live in exactly one place.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — never replace `comp`,
// `comp.tracks`, or `comp.tracks[i]` with a fresh object (that breaks the immer
// draft proxy on the store side). No fs / http here, and no CompositionSchema
// .parse (the bridge chokepoint validates on write; the store validates at its
// existing moments). The op only guarantees STRUCTURAL correctness + throws a
// typed CompositionOpError on illegal params.

import type { Composition, Clip, Keyframe } from "../../composition.js";
import { splitKeyframesAtLocal } from "../../keyframes.js";
import { CompositionOpError } from "./errors.js";

// Floating-point tolerance for the boundary no-op guards. Mirrors the
// timeline package's OFFSET_EPSILON; inlined here so the op stays free of the
// web-only `@autoviral/timeline` package (which itself imports `@shared`, so a
// dependency the other way would form a cycle).
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
 * Split the clip whose time-range contains `atSec` into two halves at that
 * timeline time. Child A keeps the original id and shrinks to `[start, atSec)`;
 * child B gets a freshly-minted id (`crypto.randomUUID()`) and covers
 * `[atSec, end)`. Keyframes are partitioned + rebased to clip-local 0 for child
 * B (#46 parity). Both halves inherit transforms / filters / style / position
 * / volume / fades identically (object spread).
 *
 * Throws `CompositionOpError{code:4}` when:
 *  - no clip matches `clipId`, or
 *  - `atSec` falls on/outside the clip's [start, end] (a boundary split would
 *    produce a zero-width child).
 *
 * Returns the minted id so the bridge can echo it back to the CLI agent.
 */
export function splitClip(
  comp: Composition,
  p: { clipId: string; atSec: number },
): { newClipId: string } {
  const { clipId, atSec } = p;
  for (const track of comp.tracks) {
    const clips = track.clips as Clip[];
    const idx = clips.findIndex((c) => c.id === clipId);
    if (idx < 0) continue;

    const orig = clips[idx];
    const start = orig.trackOffset;
    const dur = clipDuration(orig);
    const end = start + dur;
    // Boundary / out-of-clip → illegal (would mint a zero-width child).
    if (atSec <= start + OFFSET_EPSILON || atSec >= end - OFFSET_EPSILON) {
      throw new CompositionOpError(
        `splitClip: atSec ${atSec} is outside clip ${clipId} range [${start}, ${end}]`,
        4,
      );
    }

    const offsetIntoClip = atSec - start;
    const newClipId = crypto.randomUUID();

    // #46 — partition + rebase keyframes at the clip-local split point so each
    // half keeps only its own keyframes (child B rebased to clip-local 0).
    // offsetIntoClip is already the clip-local split time for every kind
    // (renderers measure keyframe time from trackOffset, not source `in`).
    const origKfs = (orig as { keyframes?: Keyframe[] }).keyframes;
    const { a: kfA, b: kfB } = origKfs
      ? splitKeyframesAtLocal(origKfs, offsetIntoClip)
      : { a: undefined as Keyframe[] | undefined, b: undefined as Keyframe[] | undefined };

    let childA: Clip;
    let childB: Clip;
    if (orig.kind === "video" || orig.kind === "audio") {
      childA = { ...orig, out: orig.in + offsetIntoClip };
      childB = {
        ...orig,
        id: newClipId,
        in: orig.in + offsetIntoClip,
        trackOffset: atSec,
      };
    } else {
      // text / overlay — duration-based.
      childA = { ...orig, duration: offsetIntoClip } as Clip;
      childB = {
        ...orig,
        id: newClipId,
        trackOffset: atSec,
        duration: dur - offsetIntoClip,
      } as Clip;
    }
    if (origKfs) {
      (childA as { keyframes?: Keyframe[] }).keyframes = kfA;
      (childB as { keyframes?: Keyframe[] }).keyframes = kfB;
    }

    // In-place splice keeps the SAME `clips` array (decision #1) and preserves
    // ordering (child A in the original slot, child B right after).
    clips.splice(idx, 1, childA, childB);
    recomputeDuration(comp);
    return { newClipId };
  }

  throw new CompositionOpError(`splitClip: no clip with id ${clipId}`, 4);
}

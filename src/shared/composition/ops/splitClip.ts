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

// Recursive structural clone that READS THROUGH the source value (works on a
// plain object AND on an immer draft Proxy — unlike `structuredClone`, which
// rejects exotic/proxy objects with DataCloneError). Clips are pure JSON data
// (no Date / Map / functions), so a plain object/array walk is faithful. Used
// to give each split half its OWN copy of every nested mutable object so a
// later in-place patch on one half can't bleed into the other.
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
 * / volume / fades identically, but via a per-child deep clone so the two
 * halves never alias the same nested mutable object (a later in-place patch on
 * one half must not bleed into the other).
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

    // Deep-clone `orig` once per child so the two halves NEVER share a nested
    // mutable object (transforms / filters / style / position / fade / …). A
    // shallow `{...orig}` only copies the top level, leaving both children
    // pointing at the SAME transforms/filters/style objects — so a later
    // in-place patch on child A (S11 patchClipProps mutates nested fields in
    // the backend mutate-comp path) would silently corrupt child B. ADR-009
    // permits deep-cloning a child's nested objects; it never replaces `comp`,
    // `comp.tracks`, or `comp.tracks[i]` (we splice fresh clip objects into the
    // SAME `clips` array below). `cloneDeep` (not `structuredClone`) is used
    // because `orig` may be an immer draft Proxy on the store path, which
    // `structuredClone` rejects with DataCloneError. We overwrite each child's
    // `keyframes` with its already-partitioned array afterwards.
    let childA: Clip = cloneDeep(orig);
    let childB: Clip = cloneDeep(orig);
    if (orig.kind === "video" || orig.kind === "audio") {
      (childA as { out: number }).out = orig.in + offsetIntoClip;
      (childB as { id: string; in: number; trackOffset: number }).id = newClipId;
      (childB as { in: number }).in = orig.in + offsetIntoClip;
      (childB as { trackOffset: number }).trackOffset = atSec;
    } else {
      // text / overlay — duration-based.
      (childA as { duration: number }).duration = offsetIntoClip;
      (childB as { id: string }).id = newClipId;
      (childB as { trackOffset: number }).trackOffset = atSec;
      (childB as { duration: number }).duration = dur - offsetIntoClip;
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

// PRD-0009 B6 — `setCompositionDuration`: the ONLY intent-op that writes the
// top-level `comp.duration` directly. The Studio store only ever GROWS duration
// (a fan-out of `Math.max(...clipEnd)` guards on every clip mutation), so an
// agent had no path to SHORTEN the overall timeline (e.g. trim a tail of static
// frames) short of overwriting the whole composition via `comp put` or hand-
// editing composition.yaml — the very dead-end chat-s_2 hit. This op is the
// shared single source of truth the bridge (`POST /comp/duration`) consumes so
// `autoviral comp set --duration <s>` and any future Studio control converge.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — never replace `comp` (that
// breaks the immer-draft proxy on the store side). No fs / http here, and no
// CompositionSchema.parse (the bridge chokepoint validates on write). Illegal
// input throws CompositionOpError{code:4}.
//
// Two modes:
//   { durationSec }  — set an EXPLICIT length. Must be a finite, non-negative
//                      number. SHORTENING below the content end is ALLOWED
//                      (cropping a tail is a legitimate intent); the caller is
//                      responsible for warning the user that tail content past
//                      the new duration will not render — see `compositionContentEnd`.
//   { auto: true }   — DERIVE the length from content: Math.max(0, ...clipEnd)
//                      across every track's clips, the exact口径 the store grows
//                      duration with (`clipEnd = trackOffset + clipDuration`).

import type { Composition, Clip } from "../../composition.js";
import { CompositionOpError } from "./errors.js";

// Inlined to keep this op free of the web-only `@autoviral/timeline` package
// (mirrors trimClip.ts / splitClip.ts — the same clipEnd口径 the store uses).
function clipDuration(c: Clip): number {
  if (c.kind === "video" || c.kind === "audio") return Math.max(0, c.out - c.in);
  return Math.max(0, (c as { duration: number }).duration);
}

function clipEnd(c: Clip): number {
  return c.trackOffset + clipDuration(c);
}

/**
 * The maximum clip end across every track — the content's natural end and the
 * value `{ auto: true }` derives. `Math.max(0, …)` so an empty composition
 * (no tracks / no clips) yields 0 rather than -Infinity. Exported so the bridge
 * can report whether an explicit duration truncates content without re-deriving.
 */
export function compositionContentEnd(comp: Composition): number {
  return Math.max(
    0,
    ...comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
  );
}

/**
 * Set `comp.duration` IN PLACE.
 *
 * `{ durationSec }` writes an explicit non-negative finite length (shortening
 * below content end is permitted). `{ auto: true }` derives the length from the
 * maximum clip end (`compositionContentEnd`), matching the store's grow-only口径.
 *
 * Throws `CompositionOpError{code:4}` when `durationSec` is not a finite,
 * non-negative number.
 */
export function setCompositionDuration(
  comp: Composition,
  p: { durationSec: number } | { auto: true },
): void {
  if ("auto" in p && p.auto) {
    comp.duration = compositionContentEnd(comp);
    return;
  }
  const { durationSec } = p as { durationSec: number };
  if (
    typeof durationSec !== "number" ||
    !Number.isFinite(durationSec) ||
    durationSec < 0
  ) {
    throw new CompositionOpError(
      `setCompositionDuration: invalid durationSec "${String(
        durationSec,
      )}" (expected a finite, non-negative number, or { auto: true })`,
      4,
    );
  }
  comp.duration = durationSec;
}

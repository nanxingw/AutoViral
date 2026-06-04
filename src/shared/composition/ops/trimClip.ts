// ADR-009 (S7) — `trimClip`: source-window trim lifted into the shared
// composition-ops core. The studio store's edge-drag (`resizeClip`) and this
// op are sibling expressions of the same invariants — adjacency cap, minimum
// duration, keyframe rebase — but `trimClip` takes the canonical intent shape
// the bridge + CLI speak: set the clip's source `in`/`out` directly
// (`autoviral clip trim <id> --in --out`). trackOffset is the ANCHOR; the op
// never moves it. So both edges are expressed purely as the clip-local source
// window [in, out], and the timeline position is fixed.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — never replace `comp`,
// `comp.tracks`, or `comp.tracks[i]` (that breaks the immer-draft proxy on the
// store side). No fs / http here, no CompositionSchema.parse (the bridge
// chokepoint validates on write). Illegal params throw CompositionOpError{
// code:4}. trim adjusts fields on the EXISTING clip object in place — no clone
// needed (no new clip is minted).

import type { Composition, Clip, Keyframe } from "../../composition.js";
import { splitKeyframesAtLocal } from "../../keyframes.js";
import { CompositionOpError } from "./errors.js";

// Inlined so the op stays free of the web-only `@autoviral/timeline` package
// (which imports `@shared` — a dependency the other way would form a cycle).
// Mirror `packages/timeline/src/clipMath.ts`.
const OFFSET_EPSILON = 1e-6;
const MIN_CLIP_DUR = 0.05;

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
 * Trim the clip's SOURCE WINDOW by setting `in` and/or `out` directly. Only
 * `video`/`audio` clips have an `in`/`out` window; `text`/`overlay` are
 * duration-based and reject a trim (code:4 — use a resize/duration op instead).
 *
 * trackOffset is the anchor and never moves. Invariants (mirroring the store's
 * edge-drag `resizeClip`):
 *  - **out** is clamped to `[in + MIN_CLIP_DUR, in + cap]`, where `cap` is the
 *    gap to the next clip on the SAME track (`nextOffset - trackOffset`), so
 *    the clip-end can never overlap a later neighbour. Single-clip tracks have
 *    no neighbour → cap = +∞. Keyframes past the new clip-local end are
 *    dropped + a boundary is added at the end (`splitKeyframesAtLocal(.a`).
 *  - **in** is clamped to `[0, out - MIN_CLIP_DUR]`. Moving `in` shifts the
 *    clip-local time origin by `delta = newIn - oldIn`, so keyframes
 *    (trackOffset-relative) rebase by `-delta` with a boundary at local 0
 *    (`splitKeyframesAtLocal(.b`) — identical math to a left-edge resize.
 *
 * Both edges may be supplied at once (an `in`/`out` window set). `out` is
 * resolved first against the (possibly new) `in`, then `in` rebases keyframes;
 * order is deterministic because each clamp reads the clip's own fields.
 *
 * Throws `CompositionOpError{code:4}` when:
 *  - no clip matches `clipId`, or
 *  - neither `in` nor `out` is provided, or
 *  - the supplied `in`/`out` pair is degenerate (`in >= out`), or
 *  - the clip is duration-based (no source window to trim).
 */
export function trimClip(
  comp: Composition,
  p: { clipId: string; in?: number; out?: number },
): void {
  const { clipId } = p;
  const wantIn = p.in;
  const wantOut = p.out;
  if (wantIn === undefined && wantOut === undefined) {
    throw new CompositionOpError(
      `trimClip: at least one of --in / --out is required for clip ${clipId}`,
      4,
    );
  }
  if (
    wantIn !== undefined &&
    wantOut !== undefined &&
    wantIn >= wantOut - OFFSET_EPSILON
  ) {
    throw new CompositionOpError(
      `trimClip: in (${wantIn}) must be strictly less than out (${wantOut})`,
      4,
    );
  }

  for (const track of comp.tracks) {
    const clips = track.clips as Clip[];
    const idx = clips.findIndex((c) => c.id === clipId);
    if (idx < 0) continue;

    const c = clips[idx];
    if (c.kind !== "video" && c.kind !== "audio") {
      throw new CompositionOpError(
        `trimClip: clip ${clipId} (${c.kind}) has no in/out source window — use a duration/resize op`,
        4,
      );
    }
    const vc = c as Extract<Clip, { kind: "video" | "audio" }>;
    const start = vc.trackOffset;

    // ── out: shrink/extend the right of the source window ──────────────────
    if (wantOut !== undefined) {
      // Adjacency cap: the clip-end (trackOffset + (out-in)) must not pass the
      // next clip's trackOffset. Express the cap in source-window terms:
      // out <= in + (nextOffset - trackOffset).
      const next = clips
        .filter(
          (x) => x.id !== clipId && x.trackOffset > start + OFFSET_EPSILON,
        )
        .sort((x, y) => x.trackOffset - y.trackOffset)[0];
      const capDur = next ? next.trackOffset - start : Infinity;
      const clampedOut = Math.min(
        vc.in + capDur,
        Math.max(vc.in + MIN_CLIP_DUR, wantOut),
      );
      const newDur = clampedOut - vc.in;
      vc.out = clampedOut;
      // #48 sibling — right-edge trim shrinks the clip-local window to
      // [0, newDur). Drop keyframes past the new end + add a boundary at it.
      const rKfs = (vc as { keyframes?: Keyframe[] }).keyframes;
      if (rKfs && rKfs.some((k) => k.time > newDur + OFFSET_EPSILON)) {
        (vc as { keyframes?: Keyframe[] }).keyframes = splitKeyframesAtLocal(
          rKfs,
          newDur,
        ).a;
      }
    }

    // ── in: shift the left of the source window (trackOffset anchored) ──────
    if (wantIn !== undefined) {
      const clampedIn = Math.min(vc.out - MIN_CLIP_DUR, Math.max(0, wantIn));
      const delta = clampedIn - vc.in;
      vc.in = clampedIn;
      // #48 sibling — moving `in` by `delta` shifts the clip-local origin, so
      // keyframes (trackOffset-relative) rebase by -delta with a boundary at
      // local 0. Same math as a left-edge resize's `.b` half.
      const lKfs = (vc as { keyframes?: Keyframe[] }).keyframes;
      if (lKfs && lKfs.length > 0 && Math.abs(delta) > OFFSET_EPSILON) {
        (vc as { keyframes?: Keyframe[] }).keyframes = splitKeyframesAtLocal(
          lKfs,
          delta,
        ).b;
      }
    }

    recomputeDuration(comp);
    return;
  }

  throw new CompositionOpError(`trimClip: no clip with id ${clipId}`, 4);
}

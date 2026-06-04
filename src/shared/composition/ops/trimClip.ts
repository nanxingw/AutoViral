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
 * trackOffset is the ANCHOR and never moves. Invariants:
 *  - **in** is resolved FIRST, clamped to `[0, out - MIN_CLIP_DUR]`. Because
 *    trackOffset does not move, an `in` change does NOT shift the keyframe time
 *    origin (keyframe `time` is trackOffset-relative — each renderer mounts the
 *    clip in `<Sequence from={trackOffset*fps}>` and reads useCurrentFrame;
 *    `clip.in` only feeds `<Video startFrom={in*fps}>`). So an `in` trim leaves
 *    keyframes UNTOUCHED. (This is the key difference from the store's left-edge
 *    `resizeClip`, which ALSO moves trackOffset by the same delta and therefore
 *    must rebase — that op is a different verb: a timeline-position move.)
 *  - **out** is resolved against the FINAL `in`, clamped to
 *    `[in + MIN_CLIP_DUR, in + cap]`, where `cap` is the gap to the next clip on
 *    the SAME track (`nextOffset - trackOffset`), so the clip-end
 *    (`trackOffset + (out - in)`) can never overlap a later neighbour — even an
 *    extend-LEFT of `in` that grows the duration is caught here, because `out`
 *    is always re-checked against the cap once `in` is final. Single-clip tracks
 *    have no neighbour → cap = +∞. Keyframes past the new clip-local end
 *    (`out - in`) are dropped + a boundary added (`splitKeyframesAtLocal(.a`).
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
    const oldOut = vc.out;

    // Adjacency cap (clip-end must not pass the next clip's trackOffset). The
    // clip-end is `trackOffset + (out - in)`, so the cap on duration is
    // `nextOffset - trackOffset`. Single-clip tracks → cap = +∞.
    const next = clips
      .filter((x) => x.id !== clipId && x.trackOffset > start + OFFSET_EPSILON)
      .sort((x, y) => x.trackOffset - y.trackOffset)[0];
    const capDur = next ? next.trackOffset - start : Infinity;

    // ── in: resolve FIRST. trackOffset stays anchored, so the keyframe time
    //    origin does not move ⇒ keyframes are NOT rebased (see docstring). An
    //    `in` change alone never touches keyframes — even one now past the
    //    (shorter) clip end is preserved (lossless; the renderer clamps it, and
    //    extending `out` back restores it). Dropping is the right edge's job. ──
    if (wantIn !== undefined) {
      vc.in = Math.min(vc.out - MIN_CLIP_DUR, Math.max(0, wantIn));
    }

    // ── out: resolve against the FINAL `in`, clamped to
    //    [in + MIN_CLIP_DUR, in + capDur]. When no `--out` was supplied we still
    //    re-clamp the EXISTING out, so an extend-LEFT of `in` that grew the
    //    duration past the cap is pulled back in here (no overlap). ───────────
    const targetOut = wantOut !== undefined ? wantOut : vc.out;
    vc.out = Math.min(vc.in + capDur, Math.max(vc.in + MIN_CLIP_DUR, targetOut));

    // Only when the RIGHT edge actually moved IN (out shrank below its old
    // value) does the clip-local window shrink → drop keyframes past the new end
    // + add a boundary (#48 sibling). An `in`-only trim leaves `out` unchanged,
    // so this is skipped and keyframes stay untouched.
    if (vc.out < oldOut - OFFSET_EPSILON) {
      const newDur = vc.out - vc.in;
      const rKfs = (vc as { keyframes?: Keyframe[] }).keyframes;
      if (rKfs && rKfs.some((k) => k.time > newDur + OFFSET_EPSILON)) {
        (vc as { keyframes?: Keyframe[] }).keyframes = splitKeyframesAtLocal(
          rKfs,
          newDur,
        ).a;
      }
    }

    recomputeDuration(comp);
    return;
  }

  throw new CompositionOpError(`trimClip: no clip with id ${clipId}`, 4);
}

// ADR-009 (S9) — `addTransition` / `removeTransition`: cut-point transitions on
// a video track, lifted into the shared composition-ops core. The studio store's
// add/remove transition path and the bridge read-modify-write path consume THESE
// two implementations, so an agent adding a transition via the CLI (`autoviral
// transition add --track --after --preset --duration`) and a human picking one in
// the UI converge on the same composition.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — never replace `comp`,
// `comp.tracks`, a track object, or the `transitions` array reference (that breaks
// the immer draft proxy on the store side). We push onto / filter back into the
// EXISTING `transitions` array so it keeps its identity. No fs / http here, and no
// CompositionSchema.parse (the bridge chokepoint validates on write; the store
// validates at its existing moments). Illegal params throw CompositionOpError{code:4}.

import type { Composition, Clip, Track } from "../../composition.js";
import { CompositionOpError } from "./errors.js";
import { snapToFrame } from "../../frame.js";
import {
  TRANSITION_PRESET_META,
  getPresetMeta,
  clampHandleDuration,
  type TransitionPreset,
} from "../../transitions.js";

// Local clip-duration helper — mirrors splitClip.ts so the ops layer stays
// self-contained (the web-only @autoviral/timeline clipMath would form a cycle).
function clipDuration(c: Clip): number {
  if (c.kind === "video" || c.kind === "audio") return Math.max(0, c.out - c.in);
  return Math.max(0, (c as { duration: number }).duration);
}

/**
 * Add a transition pinned to the cut AFTER `afterClipId` on the video track
 * `trackId`. `durationSec` defaults to the preset's registry default and is
 * always clamped to the handle (half the smaller adjacent clip) so the cross-fade
 * never over-consumes a clip. Mints + returns the transition id.
 *
 * Throws `CompositionOpError{code:4}` when:
 *  - no track matches `trackId`, or the track is not a video track (Phase 1
 *    is video-only), or
 *  - `preset` is not in the shared registry (src/shared/transitions.ts), or
 *  - `afterClipId` matches no clip on the track, or matches the LAST clip (a
 *    transition pinned to the last clip has no successor to fade INTO — the
 *    same invariant the Track superRefine enforces at parse time).
 */
export function addTransition(
  comp: Composition,
  p: { trackId: string; afterClipId: string; preset: string; durationSec?: number },
): { transitionId: string } {
  const { trackId, afterClipId, durationSec } = p;

  // Preset must come from the single source of truth (the shared registry). An
  // unknown preset is a code:4 rejection, not a silently-stored bad value.
  if (!Object.prototype.hasOwnProperty.call(TRANSITION_PRESET_META, p.preset)) {
    throw new CompositionOpError(`addTransition: unknown preset ${p.preset}`, 4);
  }
  const preset = p.preset as TransitionPreset;

  const track = comp.tracks.find((t) => t.id === trackId);
  if (!track) {
    throw new CompositionOpError(`addTransition: no track with id ${trackId}`, 4);
  }
  if (track.kind !== "video") {
    throw new CompositionOpError(
      `addTransition: transitions are video-only (track ${trackId} is ${track.kind})`,
      4,
    );
  }

  const clips = track.clips as Clip[];
  const beforeIdx = clips.findIndex((c) => c.id === afterClipId);
  if (beforeIdx < 0) {
    throw new CompositionOpError(
      `addTransition: no clip with id ${afterClipId} on track ${trackId}`,
      4,
    );
  }
  // The anchor clip must have a successor — a transition pinned to the last clip
  // has nothing to fade INTO (Track superRefine would reject it on the next parse).
  if (beforeIdx >= clips.length - 1) {
    throw new CompositionOpError(
      `addTransition: afterClipId ${afterClipId} is the last clip — no successor to fade into`,
      4,
    );
  }

  const before = clips[beforeIdx];
  const after = clips[beforeIdx + 1];
  // S15 — quantise an EXPLICIT cross-fade width to a whole frame before the
  // handle clamp (which re-floors at TRANSITION_DURATION_MIN_SEC).
  const desired =
    durationSec !== undefined
      ? snapToFrame(durationSec, comp.fps)
      : getPresetMeta(preset).defaultDurationSec;
  const dur = clampHandleDuration(desired, clipDuration(before), clipDuration(after));

  const transitionId = `tr_${crypto.randomUUID()}`;

  // In place: seed the array on the EXISTING track object if missing (keeps the
  // track identity), then push onto the EXISTING array (keeps its identity).
  if (!track.transitions) {
    (track as { transitions: NonNullable<Track["transitions"]> }).transitions = [];
  }
  track.transitions!.push({
    id: transitionId,
    afterClipId,
    preset,
    durationSec: dur,
    alignment: "center",
    easing: "linear",
  });

  return { transitionId };
}

/**
 * PRD-0014 S8 — edit a transition in place: patch its `preset` / `durationSec` /
 * `alignment` / `easing`. Found by `transitionId` across ANY track (so the store
 * action's `trackId` arg is advisory — the id is globally unique). Mutates the
 * EXISTING transition object in place (array + object identity survive — decision
 * #1). `durationSec` is ALWAYS re-clamped to the handle (half the smaller
 * adjacent clip) so the invariant survives even if a clip was trimmed after the
 * transition was added — the SAME re-clamp the Studio Inspector runs. `preset`
 * must come from the shared registry (single source of truth); an unknown preset
 * is a code:4 rejection, not a silently-stored bad value.
 *
 * Throws `CompositionOpError{code:4}` when no transition matches `transitionId`,
 * or `preset` (when given) is not in the registry.
 */
export function updateTransition(
  comp: Composition,
  p: {
    transitionId: string;
    preset?: string;
    durationSec?: number;
    alignment?: "center" | "start" | "end";
    easing?: "linear" | "spring" | "ease-in-out";
  },
): void {
  if (
    p.preset !== undefined &&
    !Object.prototype.hasOwnProperty.call(TRANSITION_PRESET_META, p.preset)
  ) {
    throw new CompositionOpError(`updateTransition: unknown preset ${p.preset}`, 4);
  }
  for (const track of comp.tracks) {
    const transitions = track.transitions;
    if (!transitions || transitions.length === 0) continue;
    const tr = transitions.find((t) => t.id === p.transitionId);
    if (!tr) continue;

    // ALWAYS re-clamp against the CURRENT adjacent clip durations — using the
    // requested durationSec when given, else the transition's own stored value.
    // A PRESET-ONLY edit (no durationSec in the patch) must still tighten a
    // now-too-large stored duration if a neighbour was trimmed AFTER the
    // transition was added (review finding 3) — otherwise the docstring's "always
    // re-clamped … even if a clip was trimmed" promise is a lie and an over-large
    // cross-fade survives. When nothing was trimmed the clamp is a no-op (the
    // stored value already fits). Only clamp when the anchor still has a successor
    // (a valid transition always does; the guard is safe against a transient
    // orphan mid-edit).
    {
      const clips = track.clips as Clip[];
      const beforeIdx = clips.findIndex((c) => c.id === tr.afterClipId);
      if (beforeIdx >= 0 && beforeIdx < clips.length - 1) {
        // S15 — quantise an EXPLICIT duration edit to a whole frame; a preset-only
        // edit keeps the stored value (already frame-aligned when it was written).
        const desired =
          p.durationSec !== undefined
            ? snapToFrame(p.durationSec, comp.fps)
            : tr.durationSec;
        tr.durationSec = clampHandleDuration(
          desired,
          clipDuration(clips[beforeIdx]),
          clipDuration(clips[beforeIdx + 1]),
        );
      }
    }
    if (p.preset !== undefined) tr.preset = p.preset as TransitionPreset;
    if (p.alignment !== undefined) tr.alignment = p.alignment;
    if (p.easing !== undefined) tr.easing = p.easing;
    return;
  }
  throw new CompositionOpError(
    `updateTransition: no transition with id ${p.transitionId}`,
    4,
  );
}

/**
 * Remove the transition `transitionId` from whichever track holds it, restoring a
 * hard cut at that point. We filter the offending entry out of the EXISTING
 * `transitions` array in place (array identity survives — decision #1).
 *
 * Throws `CompositionOpError{code:4}` when no transition matches `transitionId`
 * on any track.
 */
export function removeTransition(
  comp: Composition,
  p: { transitionId: string },
): void {
  const { transitionId } = p;
  for (const track of comp.tracks) {
    const transitions = track.transitions;
    if (!transitions || transitions.length === 0) continue;
    const idx = transitions.findIndex((tr) => tr.id === transitionId);
    if (idx >= 0) {
      transitions.splice(idx, 1); // in-place, keeps array reference
      return;
    }
  }
  throw new CompositionOpError(
    `removeTransition: no transition with id ${transitionId}`,
    4,
  );
}

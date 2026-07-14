// ADR-009 (PRD-0014 S3) — `setTransitionIn`: set (or clear) a video clip's
// ENTRANCE transition (`transitionIn: {preset, durationSec, easing?}`). Lifted
// into the shared composition-ops core so the Studio Inspector's入场转场 selector
// (store `setClipTransitionIn`) and the bridge/CLI (`autoviral clip set <id>
// --transition-in glitch:0.4`) consume THIS one implementation — an agent adding
// an entrance and a human picking one in the Inspector converge byte-for-byte.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — assign onto the EXISTING
// clip object (identity survives — the immer draft proxy on the store side).
// No fs / http and no CompositionSchema.parse. ALL validation happens BEFORE the
// single assignment so a rejected call leaves `comp` byte-identical (atomic).
// Illegal params throw CompositionOpError{code:4}.
//
// `spec === null` CLEARS the entrance (delete the field). A non-null spec:
//   - `preset` must come from the shared registry (single source of truth).
//   - `durationSec` defaults to the preset's registry default when omitted, and
//     is validated ≤ the clip's EFFECTIVE (speed-aware) duration AND within the
//     schema [0.05, 5] range so the op never produces a value the write-path
//     zod parse (refineTrack) would then reject.
//   - `easing` (optional) mirrors Transition.easing (linear/spring/ease-in-out).
// transitionIn is ORTHOGONAL to a cut-point transition — this op never touches
// track.transitions.

import type { Composition, Clip, VideoClip } from "../../composition.js";
import { effectiveClipDuration } from "../../speed-ramp.js";
import { snapToFrame } from "../../frame.js";
import {
  TRANSITION_PRESET_META,
  getPresetMeta,
  TRANSITION_DURATION_MIN_SEC,
  TRANSITION_DURATION_MAX_SEC,
  type TransitionPreset,
} from "../../transitions.js";
import { CompositionOpError } from "./errors.js";

export interface TransitionInSpec {
  preset: string;
  /** Omit to use the preset's registry default duration. */
  durationSec?: number;
  easing?: "linear" | "spring" | "ease-in-out";
}

const EASINGS = ["linear", "spring", "ease-in-out"] as const;

/**
 * Set (spec) or clear (spec===null) the entrance transition of video clip
 * `clipId`.
 *
 * Throws `CompositionOpError{code:4}` when: no clip matches `clipId`, the clip is
 * not a video clip, `preset` is not in the shared registry, `easing` is not a
 * legal value, or `durationSec` is out of the schema range / longer than the
 * clip's effective (speed-aware) duration.
 */
export function setTransitionIn(
  comp: Composition,
  p: { clipId: string; spec: TransitionInSpec | null },
): void {
  // ── Phase 1: locate + validate (no mutation yet — keep the call atomic) ──
  let video: VideoClip | undefined;
  for (const track of comp.tracks) {
    const c = (track.clips as Clip[]).find((c) => c.id === p.clipId);
    if (!c) continue;
    if (c.kind !== "video") {
      throw new CompositionOpError(
        `setTransitionIn: clip ${p.clipId} is a ${c.kind} clip, not a video clip`,
        4,
      );
    }
    video = c;
    break;
  }
  if (!video) {
    throw new CompositionOpError(`setTransitionIn: no video clip with id ${p.clipId}`, 4);
  }

  // Clear path — delete the field in place (identity of the clip survives).
  if (p.spec === null) {
    delete (video as { transitionIn?: unknown }).transitionIn;
    return;
  }

  const { preset } = p.spec;
  if (!Object.prototype.hasOwnProperty.call(TRANSITION_PRESET_META, preset)) {
    throw new CompositionOpError(`setTransitionIn: unknown preset ${preset}`, 4);
  }
  const easing = p.spec.easing;
  if (easing !== undefined && !(EASINGS as readonly string[]).includes(easing)) {
    throw new CompositionOpError(`setTransitionIn: invalid easing ${easing}`, 4);
  }

  // ≤ effective (speed-aware) clip duration — an entrance can't outlast the clip.
  const eff = effectiveClipDuration(video);
  // durationSec defaults to the preset's registry default when omitted — but an
  // OMITTED duration AUTO-FITS to the clip (finding #3): a preset whose registry
  // default (e.g. 0.5s) would overflow a short clip's effective width is clamped
  // DOWN so picking a preset in the Inspector always yields a VALID entrance
  // instead of a silent rejection. An EXPLICIT over-long duration is still
  // rejected below (agents/humans who type a number get told it doesn't fit).
  const explicit = p.spec.durationSec !== undefined;
  // S15 — quantise an EXPLICIT entrance width to a whole frame. The auto-fit
  // default (Math.min(registryDefault, eff)) is left as the clip's fractional
  // effective width so snapping-up can't push it past `eff` and self-reject.
  const durationSec = explicit
    ? snapToFrame(p.spec.durationSec as number, comp.fps)
    : Math.min(getPresetMeta(preset as TransitionPreset).defaultDurationSec, eff);
  if (!Number.isFinite(durationSec)) {
    throw new CompositionOpError(`setTransitionIn: durationSec must be a finite number`, 4);
  }
  if (durationSec < TRANSITION_DURATION_MIN_SEC || durationSec > TRANSITION_DURATION_MAX_SEC) {
    // Covers the degenerate auto-fit case too: a clip shorter than the schema
    // minimum (< 0.05s) can't host ANY valid entrance, so even the clamped value
    // is rejected here — surfaced to the user as a toast by the store wrapper.
    throw new CompositionOpError(
      `setTransitionIn: durationSec ${durationSec} out of range ` +
        `[${TRANSITION_DURATION_MIN_SEC}, ${TRANSITION_DURATION_MAX_SEC}]`,
      4,
    );
  }
  if (durationSec > eff + 1e-6) {
    throw new CompositionOpError(
      `setTransitionIn: durationSec ${durationSec} exceeds the clip's effective duration ${eff}`,
      4,
    );
  }

  // ── Phase 2: mutate. All checks passed, so the single write below lands. ──
  video.transitionIn = {
    preset: preset as TransitionPreset,
    durationSec,
    ...(easing ? { easing } : {}),
  };
}

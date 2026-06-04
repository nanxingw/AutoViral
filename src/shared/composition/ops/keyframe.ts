// ADR-009 (S12) — `addKeyframe` / `setKeyframe`: author a keyframe on a numeric
// clip property, lifted into the shared composition-ops core. Both the bridge
// keyframe-write route (`autoviral clip keyframe add/set`) and the Studio
// KeyframePanel consume the SAME collision math (`addOrReplaceKeyframe`), so an
// agent authoring a crossfade / Ken Burns curve via the CLI and a human dragging
// a keyframe in the UI converge on an identical `keyframes` array.
//
// This is the verb that finally makes `--keyframes`-flavoured edits runnable
// from the CLI (PRD-0004 S12 / US 16). The old `clip set --keyframes '[...]'`
// path was guaranteed to 400 — a scalar flag can't carry a `Keyframe[]`. Here a
// single keyframe is authored at a time with typed args.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — never replace `comp`,
// `comp.tracks`, or a track object (that breaks the immer draft proxy on the
// store side). We DO assign the clip's own `keyframes` leaf array (exactly as
// splitClip.ts and the store's `addKeyframe` action already do); that array is a
// per-clip leaf, not the comp/tracks/track reference the ADR pins. No fs / http
// here, and no CompositionSchema.parse (the bridge chokepoint validates on
// write; the store validates at its existing moments). Illegal params throw
// CompositionOpError{code:4}.

import type { Clip, Composition, KeyframeProperty, KeyframeEasing } from "../../composition.js";
import { SPEED_MIN, SPEED_MAX } from "../../composition.js";
import { addOrReplaceKeyframe } from "../../keyframes.js";
import { CompositionOpError } from "./errors.js";

// The keyframe-property enum (src/shared/composition.ts KeyframePropertySchema).
// Inlined as a Set so the op stays a pure function with no z.parse — a bad
// property is a code:4 rejection, not a silently-stored value.
const KEYFRAME_PROPERTIES: ReadonlySet<string> = new Set<KeyframeProperty>([
  "scale",
  "x",
  "y",
  "rotation",
  "opacity",
  "volume",
  "speed",
]);

// The easing enum (KeyframeEasingSchema). `undefined` defaults to "linear".
const KEYFRAME_EASINGS: ReadonlySet<string> = new Set<KeyframeEasing>([
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
]);

export interface KeyframeWrite {
  clipId: string;
  property: KeyframeProperty;
  atSec: number;
  value: number;
  easing?: KeyframeEasing;
}

/**
 * Author (add-or-replace) a keyframe at clip-local time `atSec` on `clipId`'s
 * `property` curve. Idempotent on a `(property, atSec)` collision — the new
 * value replaces the old one, never duplicating (D4). Mints the clip's
 * `keyframes` array on first write.
 *
 * Throws `CompositionOpError{code:4}` when:
 *  - no clip matches `clipId`, or
 *  - the clip is a text clip (text carries no keyframes — D8), or
 *  - `property` is not a real keyframe property, or
 *  - `atSec` is negative / non-finite (keyframe time is clip-local seconds ≥ 0), or
 *  - `value` is non-finite, or
 *  - `easing` (when given) is not a real easing, or
 *  - `property === "speed"` and `value` is outside [0.1, 4.0] (D10).
 */
export function addKeyframe(comp: Composition, p: KeyframeWrite): void {
  const { clipId, property, atSec, value, easing } = p;

  if (!KEYFRAME_PROPERTIES.has(property)) {
    throw new CompositionOpError(
      `addKeyframe: '${property}' is not a keyframe property` +
        ` (allowed: ${[...KEYFRAME_PROPERTIES].join(", ")})`,
      4,
    );
  }
  if (easing !== undefined && !KEYFRAME_EASINGS.has(easing)) {
    throw new CompositionOpError(
      `addKeyframe: '${easing}' is not a keyframe easing` +
        ` (allowed: ${[...KEYFRAME_EASINGS].join(", ")})`,
      4,
    );
  }
  if (!Number.isFinite(atSec) || atSec < 0) {
    throw new CompositionOpError(
      `addKeyframe: atSec ${atSec} must be a finite clip-local time ≥ 0`,
      4,
    );
  }
  if (!Number.isFinite(value)) {
    throw new CompositionOpError(`addKeyframe: value ${value} must be finite`, 4);
  }
  if (property === "speed" && (value < SPEED_MIN || value > SPEED_MAX)) {
    throw new CompositionOpError(
      `addKeyframe: speed keyframe value ${value} out of range [${SPEED_MIN}, ${SPEED_MAX}]`,
      4,
    );
  }

  const clip = findClip(comp, clipId);
  if (!clip) {
    throw new CompositionOpError(`addKeyframe: no clip with id ${clipId}`, 4);
  }
  if (clip.kind === "text") {
    throw new CompositionOpError(
      `addKeyframe: clip ${clipId} is a text clip — text clips carry no keyframes (D8)`,
      4,
    );
  }

  // The clip is VideoClip | AudioClip | OverlayClip — all carry the optional
  // `keyframes?: Keyframe[]` leaf. `addOrReplaceKeyframe` returns a fresh array
  // (idempotent insert + re-sort); we assign it back onto the SAME clip object
  // (its leaf array is not the comp/tracks/track reference ADR-009 pins). The
  // store's `addKeyframe` action does the exact same assignment.
  const target = clip as { keyframes?: import("../../composition.js").Keyframe[] };
  target.keyframes = addOrReplaceKeyframe(target.keyframes, {
    property,
    time: atSec,
    value,
    easing: easing ?? "linear",
  });
}

/**
 * `setKeyframe` — the same idempotent author-or-update as `addKeyframe`. Exposed
 * as a second verb so the CLI surface (`clip keyframe add` / `clip keyframe set`)
 * reads naturally: "add a keyframe here" and "set this property's value at this
 * point" are the same composition mutation (replace-on-collision), driven
 * through one implementation so the two never drift. Same code:4 guards.
 */
export function setKeyframe(comp: Composition, p: KeyframeWrite): void {
  addKeyframe(comp, p);
}

// Local clip lookup across all tracks. Mirrors the find loop in the sibling ops
// so the keyframe ops stay self-contained (no web-only timeline helper, which
// would form an import cycle through @shared).
function findClip(comp: Composition, clipId: string): Clip | undefined {
  for (const track of comp.tracks) {
    const found = (track.clips as Clip[]).find((c) => c.id === clipId);
    if (found) return found;
  }
  return undefined;
}

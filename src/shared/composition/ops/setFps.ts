// PRD-0011 F1 — `setFps`: the canvas-fps switch lifted into the shared
// composition-ops core (ADR-009 惯例, mirrors `setAspectRatio`). The Studio
// TweaksPanel fps control and the bridge read-modify-write path
// (`POST /comp/fps`) consume THIS implementation, so an agent switching fps
// via the CLI (`autoviral comp fps 24`) and a human clicking the fps control
// in the UI converge on the same composition.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — never replace `comp`
// (that breaks the immer draft proxy on the store side). No fs / http here,
// and no CompositionSchema.parse (the bridge chokepoint validates on write —
// it is the ONLY validation point per ADR-009). Illegal fps throws
// CompositionOpError{code:4}.
//
// fps is a pure playback/render clock parameter — every clip/keyframe/caption
// time field is stored in SECONDS (float), so switching fps never touches
// scenes / assets / tracks / clips. Same-value reset is a harmless no-op
// (idempotent).

import { FPS_VALUES, type Composition } from "../../composition.js";
import { CompositionOpError } from "./errors.js";

export type Fps = (typeof FPS_VALUES)[number];

/**
 * Set `comp.fps` IN PLACE to one of the four canonical values (24/25/30/60).
 *
 * Throws `CompositionOpError{code:4}` when `fps` is not one of the canonical
 * values (including non-numbers, NaN, and non-canonical numeric fps like 23,
 * 23.976, 120, or negative values). `comp` is left untouched on rejection.
 *
 * Re-applying the same value is a harmless idempotent no-op.
 */
export function setFps(comp: Composition, p: { fps: Fps }): void {
  const { fps } = p;
  if (!(FPS_VALUES as readonly number[]).includes(fps)) {
    throw new CompositionOpError(
      `setFps: invalid fps "${String(fps)}" (expected one of ${FPS_VALUES.join("/")})`,
      4,
    );
  }
  comp.fps = fps;
}

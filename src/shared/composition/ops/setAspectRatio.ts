// ADR-009 (S17) — `setAspectRatio`: one-click canvas-ratio switch lifted into
// the shared composition-ops core. The Studio aspect control (9:16 ↔ 1:1 ↔
// 16:9) and the bridge read-modify-write path (`POST /comp/aspect`) consume THIS
// implementation, so an agent switching ratio via the CLI
// (`autoviral comp aspect 1:1`) and a human clicking the aspect control in the UI
// converge on the same composition.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — never replace `comp` (that
// breaks the immer draft proxy on the store side). We assign onto the EXISTING
// `comp` object and walk `comp.tracks[i].clips[j]` in place. No fs / http here,
// and no CompositionSchema.parse (the bridge chokepoint validates on write; the
// store validates at its existing moments). Illegal ratio throws
// CompositionOpError{code:4}.
//
// Clip adaptation — switching ratio changes width/height, so a video/image
// clip's ABSOLUTE pixel offset (transforms.x / transforms.y, measured from the
// canvas centre and consumed by the renderer as `translate(${x}px,${y}px)`)
// would otherwise stay at its old magnitude and the content would drift off the
// (now differently-sized) canvas. We rescale those offsets proportionally to the
// dimension change (x by width-ratio, y by height-ratio) so a clip nudged 200px
// right of centre on a 1080-wide canvas stays proportionally placed when the
// canvas narrows/widens, never flying out of frame. Text/overlay clips position
// by PERCENTAGE (xPct/yPct/wPct/hPct) so they adapt automatically — we leave
// them untouched.

import { ASPECTS, type Aspect, type Composition } from "../../composition.js";
import { CompositionOpError } from "./errors.js";

// Canonical pixel dimensions per aspect. Kept in lockstep with the private
// ASPECT_DIMS in composition.ts (the makeEmpty* seed); duplicated here rather
// than exported so this pure op has no import-cycle back through the schema's
// factory helpers. 1080-on-the-short-edge is the shared convention.
const ASPECT_DIMS: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

/**
 * Switch `comp` to `ratio`, updating `aspect` + `width` + `height` to the
 * canonical dimensions and proportionally rescaling every video clip's absolute
 * pixel offset (transforms.x / transforms.y) so its content stays placed
 * relative to the canvas centre instead of drifting off-frame.
 *
 * No-op (still rescales nothing) when `ratio` already matches `comp.aspect` AND
 * the dimensions already match — the scale factors are 1, so the walk is inert.
 *
 * Throws `CompositionOpError{code:4}` when `ratio` is not one of the four
 * canonical aspects.
 */
export function setAspectRatio(
  comp: Composition,
  p: { ratio: Aspect },
): void {
  const { ratio } = p;
  if (!(ASPECTS as readonly string[]).includes(ratio)) {
    throw new CompositionOpError(
      `setAspectRatio: invalid ratio "${ratio}" (expected one of ${ASPECTS.join("/")})`,
      4,
    );
  }

  const dims = ASPECT_DIMS[ratio];
  const oldWidth = comp.width;
  const oldHeight = comp.height;
  // Guard a degenerate source (width/height 0 — should never happen on a parsed
  // comp, but a hand-built fixture might): treat the scale factor as 1 so we
  // never multiply offsets by NaN/Infinity.
  const sx = oldWidth > 0 ? dims.width / oldWidth : 1;
  const sy = oldHeight > 0 ? dims.height / oldHeight : 1;

  // Flip the canvas in place (decision #1 — assign onto the existing object).
  comp.aspect = ratio;
  comp.width = dims.width;
  comp.height = dims.height;

  // Rescale absolute pixel offsets on video clips so content stays
  // proportionally placed. Percentage-positioned clips (text/overlay) need no
  // mutation. Skip when both scale factors are 1 (same ratio re-applied).
  if (sx === 1 && sy === 1) return;
  for (const trk of comp.tracks) {
    for (const clip of trk.clips) {
      if (clip.kind !== "video") continue;
      const t = clip.transforms;
      if (!t) continue;
      if (typeof t.x === "number") t.x = t.x * sx;
      if (typeof t.y === "number") t.y = t.y * sy;
    }
  }
}

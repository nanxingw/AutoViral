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
// canvas narrows/widens, never flying out of frame.
//
// CRITICAL: the renderer reads `interpolateProperty(kfs,"x",…) ?? t.x`, so for a
// clip that PANS via x/y keyframes the static t.x is never read — the keyframe
// values alone drive position. We therefore scale the clip's x/y KEYFRAMES by
// the same sx/sy, not just the static transforms; otherwise a keyframed pan
// would keep old-canvas pixel magnitudes and drift off-frame anyway. scale /
// rotation / opacity / speed keyframes are dimensionless or relative and are
// left untouched.
//
// OVERLAY clips: their static placement is PERCENTAGE-based
// (position.xPct/yPct/wPct/hPct), so the base box adapts automatically and needs
// no mutation. BUT an overlay clip ALSO carries optional x/y KEYFRAMES that the
// renderer composes as ABSOLUTE PIXELS on top of that percentage box
// (`translate(${x}px, ${y}px)`, OverlayTrackRenderer). A keyframed overlay pan is
// therefore exactly as dimension-dependent as a video pan — if we left it
// untouched it would drift off a resized canvas. So we rescale overlay x/y
// keyframes by the same sx/sy too (the percentage `position` block stays
// untouched). TEXT clips have NO pixel transforms or x/y keyframes — purely
// percentage — and are left entirely untouched.

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

  // Flip the canvas in place (decision #1 — assign onto the existing object),
  // then rescale clip pixel offsets against the dimension change so content
  // stays proportionally placed instead of drifting off-frame.
  comp.aspect = ratio;
  rescaleCompositionForResize(comp, oldWidth, oldHeight, dims.width, dims.height);
}

/**
 * Resize `comp` IN PLACE to `newWidth × newHeight` and proportionally rescale
 * every clip's ABSOLUTE PIXEL offset (so content stays placed relative to the
 * canvas centre instead of drifting off-frame). This is the single source of
 * truth for the "change the canvas dimensions → adapt the clips" math, shared by
 * `setAspectRatio` (canonical-ratio switch) and the store's `applyPlatformPreset`
 * (arbitrary platform-preset dimensions) so the human-UI and agent-CLI paths
 * converge on identical compositions.
 *
 * Rescaled (× width-ratio / height-ratio respectively):
 *   - video clip `transforms.x` / `transforms.y` (static absolute offset),
 *   - video AND overlay clip x/y KEYFRAMES (the renderer composes these as
 *     `translate(${x}px,${y}px)` — a keyframed pan is dimension-dependent).
 * Left untouched: percentage placement (text/overlay `position.*Pct`) and
 * dimensionless keyframe properties (scale / rotation / opacity / speed).
 *
 * ADR-009: no I/O, mutates `comp` in place (never replaces the reference). Guards
 * a degenerate source (width/height 0 → scale factor 1, never NaN/Infinity).
 * When both scale factors are 1 (dims unchanged) the walk is inert.
 */
export function rescaleCompositionForResize(
  comp: Composition,
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
): void {
  comp.width = newWidth;
  comp.height = newHeight;

  const sx = oldWidth > 0 ? newWidth / oldWidth : 1;
  const sy = oldHeight > 0 ? newHeight / oldHeight : 1;
  if (sx === 1 && sy === 1) return;

  for (const trk of comp.tracks) {
    for (const clip of trk.clips) {
      // Static absolute offset (video only — overlay positions by percentage).
      if (clip.kind === "video") {
        const t = clip.transforms;
        if (t) {
          if (typeof t.x === "number") t.x = t.x * sx;
          if (typeof t.y === "number") t.y = t.y * sy;
        }
      }
      // x/y position KEYFRAMES are absolute pixels on BOTH video and overlay
      // clips (the renderer reads `interpolateProperty(kfs,"x",…) ?? t.x` and
      // composes `translate(${x}px,${y}px)`). On a clip that pans via keyframes
      // the static t.x is never read, so we MUST scale the keyframes too or the
      // animation keeps old-canvas pixel magnitudes and drifts off the resized
      // canvas — the very drift this helper prevents. Other keyframe properties
      // (scale/rotation/opacity/speed) are dimensionless/relative — untouched.
      if (clip.kind !== "video" && clip.kind !== "overlay") continue;
      const kfs = (clip as { keyframes?: { property: string; value: number }[] })
        .keyframes;
      if (!kfs) continue;
      for (const kf of kfs) {
        if (kf.property === "x") kf.value = kf.value * sx;
        else if (kf.property === "y") kf.value = kf.value * sy;
      }
    }
  }
}

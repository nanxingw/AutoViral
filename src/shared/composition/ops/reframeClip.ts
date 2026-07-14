// PRD-0014 S8 — `reframeClip`: PURE COMPOSITION SUGAR. It introduces NO new
// schema field; it composes two things that already exist —
//   1. `transforms.crop` (S18) — a centered strip matching the target aspect,
//   2. optional `scale` keyframes (S12) — a "punch-in" over a frame-aligned
//      [from, to] window.
// So `autoviral clip reframe <id> --aspect 9:16 --punch-in 1.2 --from --to` is a
// convenience over crop + keyframe verbs the agent could already run by hand,
// and the human UI (crop drag + keyframe drag) produces the same composition.
//
// The crop is computed against the COMPOSITION aspect (width/height) — the frame
// the clip is mounted into (fitMode cover) — so it is deterministic without
// probing the source media. Reframing to a NARROWER aspect crops a vertical
// strip (w<1, h=1); to a WIDER aspect crops a horizontal band (w=1, h<1).
//
// Decision #1/#2 (ADR-009): mutate in place, no CompositionSchema.parse here (the
// bridge chokepoint validates on write). Illegal args → CompositionOpError{code:4}.

import type { Composition, Clip, Transforms } from "../../composition.js";
import { CompositionOpError } from "./errors.js";
import { snapToFrame } from "../../frame.js";
import { addKeyframe } from "./keyframe.js";

export interface ReframeParams {
  clipId: string;
  aspect: string; // "9:16", "1:1", "16:9", …
  punchInScale?: number; // e.g. 1.2 — animates scale 1 → punchInScale
  fromSec?: number; // punch-in window start (default 0)
  toSec?: number; // punch-in window end (default clip duration)
}

function findClip(comp: Composition, clipId: string): Clip | undefined {
  for (const track of comp.tracks) {
    const found = (track.clips as Clip[]).find((c) => c.id === clipId);
    if (found) return found;
  }
  return undefined;
}

function clipDuration(c: Clip): number {
  if (c.kind === "video" || c.kind === "audio") return Math.max(0, c.out - c.in);
  return Math.max(0, (c as { duration: number }).duration);
}

// "9:16" → 9/16. Rejects malformed / non-positive parts (code:4).
function parseAspectRatio(aspect: string): number {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect.trim());
  if (!m) {
    throw new CompositionOpError(
      `reframeClip: aspect '${aspect}' must look like W:H (e.g. 9:16)`,
      4,
    );
  }
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0) || !(h > 0)) {
    throw new CompositionOpError(`reframeClip: aspect '${aspect}' parts must be > 0`, 4);
  }
  return w / h;
}

/**
 * Reframe `clipId` to `aspect` by writing a centered crop, plus an optional
 * frame-aligned punch-in on the `scale` curve.
 *
 * Throws `CompositionOpError{code:4}` when: no clip / a clip without a
 * `transforms` (audio/text carry no crop) / a malformed aspect.
 */
export function reframeClip(comp: Composition, p: ReframeParams): void {
  const clip = findClip(comp, p.clipId);
  if (!clip) {
    throw new CompositionOpError(`reframeClip: no clip with id ${p.clipId}`, 4);
  }
  // Only clips carrying a `transforms` (i.e. video) can be cropped. Overlay/text/
  // audio have no crop leaf — reframing them is meaningless.
  if (clip.kind !== "video") {
    throw new CompositionOpError(
      `reframeClip: clip ${p.clipId} is ${clip.kind} — only video clips can be reframed`,
      4,
    );
  }

  const target = parseAspectRatio(p.aspect);
  const compRatio = comp.width / comp.height;

  // Centered crop: the largest strip of the target aspect that fits the frame.
  let cx: number, cy: number, cw: number, ch: number;
  if (target < compRatio) {
    // target narrower → crop width, full height.
    cw = target / compRatio;
    ch = 1;
    cx = (1 - cw) / 2;
    cy = 0;
  } else if (target > compRatio) {
    // target wider → crop height, full width.
    cw = 1;
    ch = compRatio / target;
    cx = 0;
    cy = (1 - ch) / 2;
  } else {
    cw = 1;
    ch = 1;
    cx = 0;
    cy = 0;
  }

  // Assign the crop leaf on the EXISTING transforms object (per-clip leaf — not
  // the comp/tracks/track reference ADR-009 pins), exactly as patchClipProps
  // would land `transforms.crop.*`.
  const transforms = (clip as { transforms: Transforms }).transforms;
  transforms.crop = { x: cx, y: cy, w: cw, h: ch };

  if (p.punchInScale !== undefined) {
    if (!Number.isFinite(p.punchInScale) || p.punchInScale <= 0) {
      throw new CompositionOpError(
        `reframeClip: --punch-in ${p.punchInScale} must be a positive scale`,
        4,
      );
    }
    const fps = comp.fps;
    const dur = clipDuration(clip);
    // Snap each endpoint to the nearest frame boundary, then CLAMP into [0, dur].
    // Rounding a FRACTIONAL-frame clip duration UP can push the default
    // `to = dur` a hair past the clip end (e.g. 2.06s @30fps → 62/30 = 2.0667s);
    // `addKeyframe` rejects that as an off-clip time (code:4), so the default
    // punch-in would throw. Clamping keeps both endpoints inside the clip's own
    // span so the window can never fall out of bounds.
    // S15 — reuse the ONE shared frame-quantiser (was a private `Math.round(sec*
    // fps)/fps` copy). `snapToFrame` rejects a negative window endpoint; the
    // caller-facing窗口 defaults (0 / dur) are ≥ 0, and the `Math.min(_, dur)`
    // clamp keeps a snapped-up fractional-frame `dur` inside the clip.
    const snap = (sec: number) => Math.min(snapToFrame(sec, fps), dur);
    const from = snap(p.fromSec ?? 0);
    const to = snap(p.toSec ?? dur);
    // Reframe is composition sugar over the EXISTING transform keyframe family
    // (PRD-0014 S8: "crop + scale/x/y keyframe"). The punch-in animates `scale`
    // 1 → punchInScale; `x`/`y` are pinned to the clip's CURRENT position across
    // the same window (constant curves) so the zoom preserves framing instead of
    // snapping the clip to origin — reframe writes a COMPLETE transform keyframe
    // group, not a lone scale curve. Authoring via the shared keyframe op keeps
    // the bounds/type validation + (property, time) collision math identical to
    // the CLI/UI keyframe path.
    const curX = Number.isFinite(transforms.x) ? transforms.x : 0;
    const curY = Number.isFinite(transforms.y) ? transforms.y : 0;
    addKeyframe(comp, { clipId: p.clipId, property: "scale", atSec: from, value: 1 });
    addKeyframe(comp, {
      clipId: p.clipId,
      property: "scale",
      atSec: to,
      value: p.punchInScale,
    });
    addKeyframe(comp, { clipId: p.clipId, property: "x", atSec: from, value: curX });
    addKeyframe(comp, { clipId: p.clipId, property: "x", atSec: to, value: curX });
    addKeyframe(comp, { clipId: p.clipId, property: "y", atSec: from, value: curY });
    addKeyframe(comp, { clipId: p.clipId, property: "y", atSec: to, value: curY });
  }
}

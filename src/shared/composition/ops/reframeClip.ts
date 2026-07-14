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
    const snap = (sec: number) => Math.round(sec * fps) / fps;
    const dur = clipDuration(clip);
    const from = snap(p.fromSec ?? 0);
    const to = snap(p.toSec ?? dur);
    // Author via the shared keyframe op so bounds/type validation and the
    // (property, time) collision math are exactly what the CLI/UI keyframe path
    // uses. `addKeyframe` clamps nothing but rejects an off-clip time — snap
    // keeps both endpoints inside [0, dur].
    addKeyframe(comp, { clipId: p.clipId, property: "scale", atSec: from, value: 1 });
    addKeyframe(comp, {
      clipId: p.clipId,
      property: "scale",
      atSec: to,
      value: p.punchInScale,
    });
  }
}

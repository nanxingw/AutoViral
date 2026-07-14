// PRD-0014 S13 — `setClipMask`: set (or clear) a video clip's rect/ellipse MASK
// (`mask: {type, feather?, inverted?, rect?}`). Lifted into the shared
// composition-ops core so the Studio Inspector's mask controls (store
// `setClipMask`) and the bridge/CLI (`autoviral clip mask <id> --shape ellipse
// --feather 0.2 [--inverted]` / `--preset letterbox-2.35` / `--none`) consume
// THIS one implementation — an agent adding a mask and a human picking one in the
// Inspector converge byte-for-byte.
//
// Decision (ADR-009): mutate `comp` IN PLACE — assign onto the EXISTING clip
// object (identity survives the immer draft proxy on the store side). No fs /
// http and no CompositionSchema.parse. ALL validation happens BEFORE the single
// assignment so a rejected call leaves `comp` byte-identical (atomic). Illegal
// params throw CompositionOpError{code:4}.
//
// `spec === null` CLEARS the mask (delete the field). `{ preset }` expands a named
// preset (letterbox-<ratio>) into a concrete `{type, rect, ...}` using the
// composition's frame aspect. A direct `MaskSpec` is validated leaf-by-leaf. Mask
// params are NOT keyframe-able this version (禁).

import type { Composition, Clip, VideoClip, Mask } from "../../composition.js";
import { CompositionOpError } from "./errors.js";

export type MaskShape = "rect" | "ellipse";

export interface MaskSpec {
  type: MaskShape;
  /** Edge feather, 0 (hard) … 1 (very soft). */
  feather?: number;
  /** Keep the OUTSIDE of the shape instead of the inside (a punched hole). */
  inverted?: boolean;
  /** Normalised [0,1] bounding box; absent → the full frame. */
  rect?: { x: number; y: number; w: number; h: number };
}

export interface MaskPresetSpec {
  preset: string;
}

const SHAPES: readonly MaskShape[] = ["rect", "ellipse"];

/**
 * Expand a named mask preset into a concrete {type, rect, ...} for the given
 * composition. Supported: `letterbox-<ratio>` (e.g. `letterbox-2.35`) → a
 * centered horizontal band of that aspect (the visible content; the bars outside
 * it are masked away). Throws CompositionOpError{code:4} on an unknown preset.
 */
function expandMaskPreset(preset: string, comp: Composition): MaskSpec {
  const m = /^letterbox-(\d+(?:\.\d+)?)$/.exec(preset);
  if (m) {
    const targetAspect = Number(m[1]);
    if (!Number.isFinite(targetAspect) || targetAspect <= 0) {
      throw new CompositionOpError(`setClipMask: invalid letterbox ratio in preset ${preset}`, 4);
    }
    const frameAspect = comp.width / comp.height;
    // The visible band's HEIGHT fraction: a `targetAspect`-wide strip that spans
    // the full frame width occupies frameAspect/targetAspect of the frame height.
    // Clamp into (0,1] so an already-wider-than-target frame degenerates to the
    // full frame (no bars) instead of an out-of-range rect.
    const hf = Math.min(1, Math.max(1e-4, frameAspect / targetAspect));
    return {
      type: "rect",
      // inverted:false → keep the central band (the bars become transparent —
      // black over the canvas backdrop). NOTE: the PRD text said "rect+inverted"
      // but under keep-inside-default semantics a central-band letterbox is
      // NON-inverted; keep-inside is the intuitive Inspector default (spotlight).
      rect: { x: 0, y: (1 - hf) / 2, w: 1, h: hf },
    };
  }
  throw new CompositionOpError(`setClipMask: unknown preset ${preset}`, 4);
}

function isPreset(spec: MaskSpec | MaskPresetSpec): spec is MaskPresetSpec {
  return typeof (spec as MaskPresetSpec).preset === "string";
}

/**
 * Set (spec), preset-expand ({preset}) or clear (spec===null) the mask of video
 * clip `clipId`.
 *
 * Throws `CompositionOpError{code:4}` when: no clip matches `clipId`, the clip is
 * not a video clip, `type` is not rect/ellipse, `feather` is out of [0,1], `rect`
 * is out of bounds / zero-area, or `preset` is unknown.
 */
export function setClipMask(
  comp: Composition,
  p: { clipId: string; spec: MaskSpec | MaskPresetSpec | null },
): void {
  // ── Phase 1: locate + validate (no mutation yet — keep the call atomic) ──
  let video: VideoClip | undefined;
  for (const track of comp.tracks) {
    const c = (track.clips as Clip[]).find((c) => c.id === p.clipId);
    if (!c) continue;
    if (c.kind !== "video") {
      throw new CompositionOpError(
        `setClipMask: clip ${p.clipId} is a ${c.kind} clip, not a video clip`,
        4,
      );
    }
    video = c;
    break;
  }
  if (!video) {
    throw new CompositionOpError(`setClipMask: no video clip with id ${p.clipId}`, 4);
  }

  // Clear path — delete the field in place (identity of the clip survives).
  if (p.spec === null) {
    delete (video as { mask?: unknown }).mask;
    return;
  }

  const spec: MaskSpec = isPreset(p.spec) ? expandMaskPreset(p.spec.preset, comp) : p.spec;

  if (!SHAPES.includes(spec.type)) {
    throw new CompositionOpError(`setClipMask: unknown mask shape ${spec.type}`, 4);
  }
  if (spec.feather !== undefined) {
    if (!Number.isFinite(spec.feather) || spec.feather < 0 || spec.feather > 1) {
      throw new CompositionOpError(
        `setClipMask: feather ${spec.feather} out of range [0, 1]`,
        4,
      );
    }
  }
  if (spec.rect !== undefined) {
    const r = spec.rect;
    const leaves = [r.x, r.y, r.w, r.h];
    if (!leaves.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) {
      throw new CompositionOpError(`setClipMask: rect leaves must be in [0,1]`, 4);
    }
    if (r.w <= 0 || r.h <= 0) {
      throw new CompositionOpError(`setClipMask: rect must enclose a positive area (w>0, h>0)`, 4);
    }
    if (r.x + r.w > 1 + 1e-9 || r.y + r.h > 1 + 1e-9) {
      throw new CompositionOpError(`setClipMask: rect must stay inside the frame (x+w<=1, y+h<=1)`, 4);
    }
  }

  // ── Phase 2: mutate. All checks passed, so the single write below lands. ──
  const next: Mask = { type: spec.type };
  if (spec.feather !== undefined) next.feather = spec.feather;
  if (spec.inverted !== undefined) next.inverted = spec.inverted;
  if (spec.rect !== undefined) next.rect = { ...spec.rect };
  video.mask = next;
}

// ADR-009 — `patchClipProps`: the intent-level "set a clip property" mutation
// lifted into the shared composition-ops core. Both the bridge PATCH /clip
// route and (future) studio store consume THIS one implementation so a CLI
// `clip set` and a UI inspector edit produce an identical composition.
//
// The PRD-0004 #4 hard-bug it kills: the old PATCH route did a shallow
// `{ ...clip, ...patch }` spread and then let `CompositionSchema.parse` (which
// has NO `.strict()`) SILENTLY STRIP any unknown / nested / misspelled key.
// `clip set v1 --scal 2` would 200-OK while changing nothing — the worst kind
// of bug, a silent no-op. This op instead validates every key against a
// PER-KIND whitelist of (possibly nested, dot-pathed) properties and THROWS
// `CompositionOpError{code:4}` on the first unknown key — all-or-nothing, no
// partial write, no silent strip.
//
// Decision #1/#2 (ADR-009): mutate the clip IN PLACE (never replace the clip
// object) so the immer draft proxy on the store side stays intact. No fs / http
// here, and no CompositionSchema.parse — the bridge chokepoint validates on
// write. The op only guarantees the patch lands at the right (whitelisted)
// nested path, or rejects.

import type { Clip } from "../../composition.js";
import { CompositionOpError } from "./errors.js";

// Per-kind whitelist of patchable property paths. A path is either a top-level
// scalar (`volume`) or a dotted nested path (`transforms.scale`). `id` and
// `kind` are NEVER patchable on any kind (changing them would corrupt the
// discriminated union / break id references). These mirror the writable leaf
// fields of each clip schema in ../../composition.ts — keep in lockstep if a
// schema field is added.
const ALLOWED_PATHS: Record<Clip["kind"], readonly string[]> = {
  video: [
    "src",
    "in",
    "out",
    "trackOffset",
    "fitMode", // S16 (US 25) — fit-fill mode (cover/contain/blur)
    "transforms.scale",
    "transforms.x",
    "transforms.y",
    "transforms.rotation",
    // S18 (US 27/28) — crop sub-region (normalised {x,y,w,h}) + mirror flags.
    "transforms.crop.x",
    "transforms.crop.y",
    "transforms.crop.w",
    "transforms.crop.h",
    "transforms.flipH",
    "transforms.flipV",
    "filters.lut",
    "filters.brightness",
    "filters.contrast",
    "filters.saturation",
  ],
  audio: [
    "src",
    "in",
    "out",
    "trackOffset",
    "volume",
    "fadeIn",
    "fadeOut",
    "ducking.ratio",
    "ducking.attack",
    "ducking.release",
    "type",
  ],
  text: [
    "text",
    "trackOffset",
    "duration",
    "style.font",
    "style.size",
    "style.weight",
    "style.italic",
    "style.tracking",
    "style.color",
    "style.stroke.width",
    "style.stroke.color",
    "position.anchor",
    "position.xPct",
    "position.yPct",
    "animation",
  ],
  overlay: [
    "src",
    "trackOffset",
    "duration",
    "position.xPct",
    "position.yPct",
    "position.wPct",
    "position.hPct",
    "opacity",
  ],
};

/**
 * Patch one clip's properties from a flat `{ path: value }` map, where each
 * path is a top-level key (`volume`) or a dot-separated nested path
 * (`transforms.scale`, `ducking.ratio`, `style.stroke.color`).
 *
 * Validation is the whole point: EVERY path is checked against the per-kind
 * whitelist BEFORE any value is written. The first unknown / misspelled /
 * wrong-kind path throws `CompositionOpError{code:4}` and the clip is left
 * completely untouched (all-or-nothing — no partial write, no silent strip).
 *
 * Mutates `clip` in place. Intermediate nested objects are created on demand
 * (e.g. patching `ducking.ratio` on a clip with no `ducking` yet mints the
 * object) so an agent can set a nested leaf without first writing the parent.
 *
 * Returns nothing — callers read the mutated `clip`.
 */
export function patchClipProps(
  clip: Clip,
  patch: Record<string, unknown>,
): void {
  const allowed = ALLOWED_PATHS[clip.kind];
  if (!allowed) {
    throw new CompositionOpError(
      `patchClipProps: unknown clip kind '${(clip as { kind: string }).kind}'`,
      4,
    );
  }
  const allowedSet = new Set(allowed);

  // Phase 1 — validate ALL paths first. We do this before touching the clip so
  // a single bad key aborts the whole patch with the clip byte-equal preserved.
  for (const path of Object.keys(patch)) {
    if (!allowedSet.has(path)) {
      throw new CompositionOpError(
        `patchClipProps: '${path}' is not a settable property of a ${clip.kind} clip` +
          ` (allowed: ${allowed.join(", ")})`,
        4,
      );
    }
  }

  // Phase 2 — write. All paths are now known-good, so every set lands.
  for (const [path, value] of Object.entries(patch)) {
    setNestedPath(clip as Record<string, unknown>, path, value);
  }
}

/**
 * Write `value` at a dot-separated `path` inside `obj`, minting intermediate
 * objects as needed. `"a.b.c"` walks/creates `obj.a.b` then sets `.c = value`.
 */
function setNestedPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path.split(".");
  let cursor = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = cursor[seg];
    if (next === null || typeof next !== "object") {
      cursor[seg] = {};
    }
    cursor = cursor[seg] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

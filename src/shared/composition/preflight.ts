// ADR-009 (#5 sibling of ops/preflight) — PURE composition preflight.
//
// S13 (US 11/12) — `preflight(candidate)` lets an agent VALIDATE a candidate
// composition BEFORE it ever hits disk, so it can fix shape/semantic problems
// up front instead of running the expensive "PUT → 400 → read zod dump → guess"
// loop. It is the read-side twin of the write chokepoint:
//   - errors[]   = blocking problems (CompositionSchema.safeParse failures).
//                  A candidate with errors WILL be rejected by the write path.
//   - warnings[] = non-blocking semantic smells (track overlap, dangling
//                  caption segment ids, undeclared asset refs). The write path
//                  still accepts these; surfacing them lets the agent self-heal.
//
// PURITY CONTRACT (ADR-009): this module is IO-free. No fs / http / event bus.
// It is the ONE @shared module allowed to call the schema's safeParse, because
// it IS the validator (the no-parse rule covers mutators, not the validator
// itself). The fs-bound `missing-asset` lint rule lives in
// src/composition/quality/lint.ts and is deliberately NOT mirrored here —
// preflight reasons about SHAPE + CROSS-REFERENCES only, never about disk state.
//
// S13 rework — preflight validates against the STRICT CompositionWriteSchema,
// the SAME schema the write chokepoint (writeCompositionFor) enforces. The
// lenient CompositionSchema is a plain z.object that SILENTLY STRIPS unknown
// keys, so a typo'd top-level key (`tracts`) or clip field (`bogusClipField`)
// used to PASS preflight (ok:true, false-green) yet still 400 + code:4 at
// `comp put` — defeating the whole point of validating first. Validating
// against CompositionWriteSchema makes the unrecognized_keys rejection flow
// through preflight, so what passes here passes the write, and what fails here
// fails the write. Same gate for /comp/validate AND PUT /comp?dry-run.

import {
  CompositionWriteSchema,
  type Composition,
} from "../composition.js";
import { detectOverlaps, formatOverlap } from "./overlap.js";

export interface PreflightResult {
  /** True iff there are zero blocking errors. Warnings do NOT flip this. */
  ok: boolean;
  /** Blocking problems — a candidate with any of these fails the write path. */
  errors: string[];
  /** Non-blocking semantic smells worth surfacing to the agent. */
  warnings: string[];
}

/**
 * Validate a candidate composition without touching disk.
 *
 * `candidate` is intentionally `unknown` — an agent's hand-built composition
 * may be any shape, and the whole point is to tell it how far off it is.
 */
export function preflight(candidate: unknown): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1) Schema gate. safeParse never throws — we collect every issue as a
  //    blocking error. If the shape is wrong the semantic checks below would
  //    operate on garbage, so we stop here and return the schema errors.
  //    S13 rework: STRICT write schema, not the lenient read schema — see the
  //    module header. This is what makes preflight agree with `comp put`.
  const parsed = CompositionWriteSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      errors.push(path ? `${path}: ${issue.message}` : issue.message);
    }
    return { ok: false, errors, warnings };
  }

  const comp = parsed.data;
  collectWarnings(comp, warnings);
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * IO-free semantic checks mirrored from src/composition/quality/lint.ts (minus
 * the fs-bound `missing-asset` rule). Surfaced as WARNINGS — the write path
 * accepts them, but they're worth flagging so the agent can fix them
 * pre-emptively.
 */
function collectWarnings(comp: Composition, warnings: string[]): void {
  // track-overlap — two clips on one track whose timeline ranges intersect.
  // S15 (PRD-0014, review findings 4/5/6): delegates to the ONE shared detector
  // (composition/overlap.ts) instead of a hand-rolled loop, so this warning layer
  // and the `track-overlap` lint rule agree byte-for-byte. The detector is
  // speed-aware (effectiveClipDuration, not raw out-in), reports every overlapping
  // pair (full pairwise, not just adjacent), exempts overlay lanes (PiP stacks),
  // and yields structured {clipAId, clipBId, start, end} records we format here.
  for (const rec of detectOverlaps(comp)) {
    warnings.push(formatOverlap(rec));
  }

  // dangling-segment-id — caption groups must reference declared segments.
  if (comp.captions) {
    const segIds = new Set(comp.captions.segments.map((s) => s.segmentId));
    comp.captions.groups.forEach((g) => {
      for (const sid of g.segmentIds) {
        if (!segIds.has(sid)) {
          warnings.push(
            `caption group "${g.groupId}" references missing segment id "${sid}"`,
          );
        }
      }
    });
  }

  // orphan-clip — a clip `src` that LOOKS like an asset id (no slash, no dot)
  // but isn't declared in assets[]. Plain disk paths are fine; only the
  // id-shaped refs are flagged.
  const assetIds = new Set(comp.assets.map((a) => a.id));
  const assetUris = new Set(
    comp.assets.map((a) => (a as unknown as { uri?: string }).uri ?? ""),
  );
  comp.tracks.forEach((track) => {
    track.clips.forEach((clip) => {
      const c = clip as unknown as { id?: string; src?: string };
      if (!c.src) return;
      const looksLikeAssetId = !c.src.includes("/") && !c.src.includes(".");
      if (looksLikeAssetId && !assetIds.has(c.src) && !assetUris.has(c.src)) {
        warnings.push(
          `clip "${c.id ?? "<unnamed>"}" references undeclared asset id "${c.src}"`,
        );
      }
    });
  });
}

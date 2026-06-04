// Backend-side carousel.yaml IO — the carousel analogue of composition-ops.
//
// I08 / ADR-006: now that CarouselSchema lives in src/shared/ (I06), the
// SERVER can finally validate carousel mutations before they touch disk —
// exactly what unblocks `autoviral carousel add-slide / set-layer`. Until
// this module existed, the agent blind-wrote carousel.yaml and any shape
// error surfaced only as a Studio-side "carousel_unreadable" 500 the user
// had to debug. Now an invalid mutation throws synchronously and the
// existing carousel.yaml is left UNTOUCHED — the same atomic invariant the
// clip endpoints rely on.
//
// Layout convention (see specs/2026-05-14-agentic-terminal-bridge-protocol.md
// §Environment contract): per-work files live under
//   ${AUTOVIRAL_WORKS_ROOT or ~/.autoviral/works}/${workId}/carousel.yaml

import { readFile, writeFile, rename, mkdtemp, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import yaml from "js-yaml";
import {
  CarouselSchema,
  LayerSchema,
  genLayerId,
  makeEmptyCarousel,
  type Carousel,
  type Layer,
} from "../../shared/carousel.js";
import { migrate } from "../../shared/migrations/index.js";

export interface CarouselOpsContext {
  workId: string;
  /** Override for tests / non-default work roots. Defaults to ~/.autoviral/works. */
  worksRoot?: string;
}

function resolveRoot(ctx: CarouselOpsContext): string {
  return (
    ctx.worksRoot ??
    process.env.AUTOVIRAL_WORKS_ROOT ??
    join(homedir(), ".autoviral/works")
  );
}

export function carouselPathFor(ctx: CarouselOpsContext): string {
  return join(resolveRoot(ctx), ctx.workId, "carousel.yaml");
}

export async function readCarouselFor(ctx: CarouselOpsContext): Promise<Carousel> {
  const path = carouselPathFor(ctx);
  const raw = await readFile(path, "utf8");
  const parsed = yaml.load(raw);
  // I10 — run the carousel migration chain before zod sees the doc, so a
  // pre-versioned carousel.yaml is forward-migrated on read (currently a
  // no-op — the carousel chain is empty — but symmetric with composition
  // and future-proof). The next write naturally persists the migrated shape.
  const migrated = migrate("carousel", parsed);
  return CarouselSchema.parse(migrated);
}

// Atomic write: validate → tmpfile → rename. Validation happens BEFORE any
// tmpfile is allocated, so an invalid carousel leaves ZERO filesystem
// traces — readers either see the OLD content or the new content, never a
// partial / invalid write.
export async function writeCarouselFor(
  ctx: CarouselOpsContext,
  carousel: Carousel,
): Promise<void> {
  const validated = CarouselSchema.parse(carousel);
  const target = carouselPathFor(ctx);
  await mkdir(dirname(target), { recursive: true });
  const tmpDir = await mkdtemp(join(tmpdir(), "autoviral-carousel-"));
  const tmpPath = join(tmpDir, "carousel.yaml");
  // lineWidth:-1 keeps long gradient / base64 values on a single line, matching
  // the PUT /api/works/:id/carousel writer so disk shape is stable across writers.
  await writeFile(tmpPath, yaml.dump(validated, { lineWidth: -1 }), "utf8");
  await rename(tmpPath, target);
}

// Read–modify–write helper. The mutator returns the next carousel; we
// re-validate (inside writeCarouselFor) and atomically replace.
//
// S2 (US 17) — `onCommitted` fires ONLY after the atomic write succeeds (the
// carousel twin of mutateCompositionFor). On a mutator / validation / IO
// failure we throw before reaching onCommitted, so a "carousel-changed"
// broadcast wired to this callback only ever fires when carousel.yaml
// genuinely changed — the explicit write-path signal that replaces fs.watch.
// carousel-ops intentionally does NOT import uiEventBus; onCommitted is a
// plain callback and routes.ts supplies the broadcast closure.
export async function mutateCarouselFor(
  ctx: CarouselOpsContext,
  mutator: (carousel: Carousel) => Carousel,
  onCommitted?: (next: Carousel) => void,
): Promise<Carousel> {
  // First-write symmetry with composition-ops: a freshly-created image-text
  // work has NO carousel.yaml on disk yet — the Editor holds makeEmptyCarousel
  // in memory and only writes on the first user save. Without this, the most
  // common agent path (create image-text work → `autoviral carousel add-slide`)
  // ENOENTs on the very first command. Seed the canonical blank carousel
  // (makeEmptyCarousel — the same shape the Editor shows) so the mutation
  // applies to it and the next write materialises carousel.yaml on disk.
  let current: Carousel;
  try {
    current = await readCarouselFor(ctx);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    current = makeEmptyCarousel(ctx.workId);
  }
  const next = mutator(current);
  await writeCarouselFor(ctx, next);
  // S2 hardening (symmetric with composition-ops) — the atomic write already
  // landed; a throwing onCommitted broadcast must NOT turn that successful
  // write into a rejected mutate (route 400/500 lying about a committed write).
  // onCommitted MUST NOT throw, but we defend so a future broadcast closure
  // can't invalidate a committed write.
  try {
    onCommitted?.(next);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[carousel-ops] onCommitted broadcast failed (write already landed, non-fatal): ${
        (err as Error).message
      }`,
    );
  }
  return next;
}

// ─── set-layer: PATCH semantics (carousel twin of patchClipProps) ────────────
//
// The carousel `set-layer` mutation used to be a REPLACE: it built a brand-new
// Layer from the request body alone and `LayerSchema.parse` filled every
// UNSUPPLIED field with its schema default, then the whole layer overwrote the
// existing one. So an agent that only wanted to change a text layer's `--text`
// would silently clobber that layer's box / font / size / weight / italic /
// align / tracking / color back to defaults — exactly the kind of destructive
// surprise S11's `patchClipProps` (clip set) eliminated for video/audio clips.
//
// `applyLayerPatch` aligns the two. When `incoming.id` matches an EXISTING
// layer it DEEP-MERGES the incoming partial onto that layer (only the fields
// the caller actually supplied are overridden; nested `box` / `style` /
// `filters` merge per-leaf), then validates. When there is no match (new id or
// no id) it mints/creates a fresh layer exactly as before (zod fills defaults).
//
// Like patchClipProps, `kind` is NEVER patchable on an existing layer: changing
// it would discard all kind-specific fields (the whole point of the merge) and
// corrupt the discriminated union. A kind change on a matched id is rejected.

/** Deep-merge `patch` onto `base`: scalars/arrays overwrite, plain objects
 *  recurse so a partial nested object (e.g. `style: { color }`) only overrides
 *  the supplied leaves and preserves the rest. `undefined` patch values are
 *  skipped (a missing flag must not erase a field). */
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const prev = out[k];
    if (isPlainObject(prev) && isPlainObject(v)) {
      out[k] = deepMerge(prev, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Resolve a `set-layer` request against a slide's existing layers, returning
 * the validated Layer to store. Pure (no IO) so the route and unit tests share
 * one code path.
 *
 * - No matching id (or no id) → CREATE: validate `incoming` as a full layer
 *   (`LayerSchema.parse` fills per-kind defaults), minting an id if absent.
 * - Matching id → PATCH: deep-merge `incoming` onto the existing layer so
 *   unsupplied fields are PRESERVED, then re-validate. A kind change on a
 *   matched id throws (kind is not patchable, mirroring patchClipProps).
 *
 * Throws on a malformed layer (unknown kind, missing required field, kind
 * change) — the caller surfaces it as a 400 + code:4 and the carousel is left
 * untouched.
 */
export function applyLayerPatch(
  existingLayers: readonly Layer[],
  incoming: Record<string, unknown>,
): Layer {
  const incomingId =
    typeof incoming.id === "string" && incoming.id.length > 0
      ? incoming.id
      : undefined;
  const existing = incomingId
    ? existingLayers.find((l) => l.id === incomingId)
    : undefined;

  if (!existing) {
    // CREATE — same contract as before: full-layer validate, mint id if absent.
    return LayerSchema.parse({ ...incoming, id: incomingId ?? genLayerId() });
  }

  // PATCH — kind is immutable on an existing layer.
  if (
    typeof incoming.kind === "string" &&
    incoming.kind !== existing.kind
  ) {
    throw new Error(
      `set-layer: cannot change layer ${existing.id} kind from "${existing.kind}" to "${incoming.kind}" ` +
        `(create a new layer instead)`,
    );
  }
  // Deep-merge the incoming partial onto the existing layer, then re-validate.
  // `kind` and `id` are pinned to the existing layer's (kind is immutable; id
  // already matched). Unsupplied fields survive the merge untouched.
  const merged = deepMerge(
    existing as unknown as Record<string, unknown>,
    incoming,
  );
  merged.id = existing.id;
  merged.kind = existing.kind;
  return LayerSchema.parse(merged);
}

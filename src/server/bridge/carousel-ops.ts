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
import { CarouselSchema, makeEmptyCarousel, type Carousel } from "../../shared/carousel.js";
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
export async function mutateCarouselFor(
  ctx: CarouselOpsContext,
  mutator: (carousel: Carousel) => Carousel,
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
  return next;
}

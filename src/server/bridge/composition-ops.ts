// Backend-side composition.yaml IO. The bridge HTTP routes (GET /comp,
// /clips, /assets and — in Phase 3 — the write endpoints) delegate to
// this module so the on-disk shape is owned in exactly one place.
//
// Layout convention (see specs/2026-05-14-agentic-terminal-bridge-protocol.md
// §Environment contract): per-work files live under
//   ${AUTOVIRAL_CWD or ~/.autoviral/works}/${workId}/composition.yaml
//
// Phase 3: write helpers go through tmpfile + atomic rename, and EVERY
// write is zod-validated before it touches disk. An invalid mutator
// throws synchronously and the existing composition.yaml is left
// untouched — that's the only invariant agents can rely on when chaining
// mutations.

import { readFile, writeFile, rename, mkdtemp, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import yaml from "js-yaml";
import { CompositionSchema, type Composition } from "../../shared/composition.js";

export interface OpsContext {
  workId: string;
  /** Override for tests / non-default work roots. Defaults to ~/.autoviral/works. */
  worksRoot?: string;
}

function resolveRoot(ctx: OpsContext): string {
  return (
    ctx.worksRoot ??
    process.env.AUTOVIRAL_WORKS_ROOT ??
    join(homedir(), ".autoviral/works")
  );
}

export function compositionPathFor(ctx: OpsContext): string {
  return join(resolveRoot(ctx), ctx.workId, "composition.yaml");
}

export async function readCompositionFor(ctx: OpsContext): Promise<Composition> {
  const path = compositionPathFor(ctx);
  const raw = await readFile(path, "utf8");
  const parsed = yaml.load(raw);
  return CompositionSchema.parse(parsed);
}

// Atomic write: validate → tmpfile → rename. Rename on the same
// filesystem is POSIX-atomic, so readers either see the OLD content or
// the new content, never a partial write. If validation fails (zod
// throws) we abort BEFORE creating any tmpfile, so disk state is
// untouched on validation errors. (M114 sediment: M232 sweep + 2026-05
// dirty-tree audit — atomic writes prevent half-written yaml from
// crashing the agent on next read.)
export async function writeCompositionFor(
  ctx: OpsContext,
  comp: Composition,
): Promise<void> {
  // Validate via schema before writing — zod throws on shape mismatch.
  // We intentionally do this BEFORE allocating tmpfile so an invalid
  // composition leaves zero filesystem traces.
  const validated = CompositionSchema.parse(comp);
  const target = compositionPathFor(ctx);
  await mkdir(dirname(target), { recursive: true });
  const tmpDir = await mkdtemp(join(tmpdir(), "autoviral-comp-"));
  const tmpPath = join(tmpDir, "composition.yaml");
  await writeFile(tmpPath, yaml.dump(validated), "utf8");
  await rename(tmpPath, target);
}

// Read–modify–write helper. The mutator may return a new composition
// or mutate in place; either way we re-validate and atomically replace.
export async function mutateCompositionFor(
  ctx: OpsContext,
  mutator: (comp: Composition) => Composition,
): Promise<Composition> {
  const current = await readCompositionFor(ctx);
  const next = mutator(current);
  await writeCompositionFor(ctx, next);
  return next;
}

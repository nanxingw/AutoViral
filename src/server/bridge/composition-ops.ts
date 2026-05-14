// Backend-side composition.yaml IO. The bridge HTTP routes (GET /comp,
// /clips, /assets and — in Phase 3 — the write endpoints) delegate to
// this module so the on-disk shape is owned in exactly one place.
//
// Layout convention (see specs/2026-05-14-agentic-terminal-bridge-protocol.md
// §Environment contract): per-work files live under
//   ${AUTOVIRAL_CWD or ~/.autoviral/works}/${workId}/composition.yaml

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { CompositionSchema, type Composition } from "../../shared/composition.js";

export interface OpsContext {
  workId: string;
  /** Override for tests / non-default work roots. Defaults to ~/.autoviral/works. */
  worksRoot?: string;
}

function resolveRoot(ctx: OpsContext): string {
  return ctx.worksRoot ?? join(homedir(), ".autoviral/works");
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

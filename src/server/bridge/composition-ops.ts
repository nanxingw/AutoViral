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

import {
  readFile,
  writeFile,
  rename,
  mkdtemp,
  mkdir,
  copyFile,
  access,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import yaml from "js-yaml";
import {
  CompositionSchema,
  CompositionWriteSchema,
  migrateLegacyTrackIds,
  type Composition,
} from "../../shared/composition.js";
import { preflight, type PreflightResult } from "../../shared/composition/preflight.js";

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

/**
 * Phase 5 Task 5.4 — sibling file that holds the previous content of
 * composition.yaml at the moment of the most recent write. Used by
 * `autoviral comp diff` to surface unified diffs.
 *
 * Naming: NOT `.bak` — the legacy crossfade-fix tooling already uses
 * `.bak` in user workspaces, so we'd stomp on real backup data.
 * `.previous` is unambiguous and never used elsewhere in the project.
 */
export function compositionPreviousPathFor(ctx: OpsContext): string {
  return join(resolveRoot(ctx), ctx.workId, "composition.yaml.previous");
}

export async function readCompositionFor(ctx: OpsContext): Promise<Composition> {
  const path = compositionPathFor(ctx);
  const raw = await readFile(path, "utf8");
  const parsed = yaml.load(raw);
  // Phase D (issue #31) — read-time migration for pre-Phase-D yaml. Schema
  // stays strict; the helper rewrites legacy `audio-0`/`video-0`/... ids to
  // `trk_<uuid>` and back-fills `displayOrder` before zod sees them. Next
  // write naturally persists the migrated shape.
  const migrated = migrateLegacyTrackIds(parsed);
  return CompositionSchema.parse(migrated);
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
  //
  // S4 — use the STRICT write schema (not the lenient read schema). The read
  // schema silently STRIPS unknown / misspelled keys; on the write path that's
  // silent data loss: an agent's typo'd top-level key (`tracts`,
  // `exportPreset`) or clip field would be dropped to disk with a 200 and no
  // feedback. CompositionWriteSchema rejects unknown keys at the composition,
  // track, AND clip-union levels so the mistake fails loud (the route turns the
  // throw into 400 + code:4) and disk is left untouched.
  const validated = CompositionWriteSchema.parse(comp);
  const target = compositionPathFor(ctx);
  await mkdir(dirname(target), { recursive: true });

  // Phase 5 Task 5.4 — snapshot the current composition.yaml (if any)
  // into composition.yaml.previous BEFORE the atomic write so
  // `autoviral comp diff` has a baseline to compare against. We use
  // copyFile (fs-level, no parsing) so an unparseable on-disk file
  // still survives as a literal diff baseline.
  try {
    await copyFile(target, compositionPreviousPathFor(ctx));
  } catch (err) {
    // Most common cause: first write, no prior composition.yaml exists.
    // Any other error (perm, IO) is non-fatal for the write itself; we
    // intentionally don't surface diff-baseline IO failures as a write
    // failure because the diff feature is auxiliary.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      // eslint-disable-next-line no-console
      console.warn(
        `[composition-ops] failed to snapshot previous composition: ${
          (err as Error).message
        }`,
      );
    }
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "autoviral-comp-"));
  const tmpPath = join(tmpDir, "composition.yaml");
  await writeFile(tmpPath, yaml.dump(validated), "utf8");
  await rename(tmpPath, target);
}

/**
 * Phase 5 Task 5.4 — unified diff between composition.yaml.previous and
 * current composition.yaml. Returns:
 *   - `{ diff: string, hasBaseline: true }` with a unified diff (may be
 *     empty if files match)
 *   - `{ diff: "", hasBaseline: false }` if no .previous snapshot exists
 *     (first-write case, before any mutation)
 *   - Throws if reading the current composition fails.
 *
 * We deliberately keep the implementation dependency-free — a small
 * line-level unified diff is fine for human inspection at the CLI; we
 * are not building a syntax-aware yaml diff.
 */
export async function diffCompositionFor(
  ctx: OpsContext,
): Promise<{ diff: string; hasBaseline: boolean }> {
  const target = compositionPathFor(ctx);
  const previous = compositionPreviousPathFor(ctx);
  let current: string;
  try {
    current = await readFile(target, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { diff: "", hasBaseline: false };
    }
    throw err;
  }
  let baseline: string;
  try {
    await access(previous);
    baseline = await readFile(previous, "utf8");
  } catch {
    return { diff: "", hasBaseline: false };
  }
  return {
    diff: unifiedDiff(baseline, current, "composition.yaml.previous", "composition.yaml"),
    hasBaseline: true,
  };
}

/**
 * Minimal line-level unified diff. NOT a Myers diff — we walk both
 * files looking for the longest common prefix, then the longest common
 * suffix, and emit a single hunk for the middle. This is deterministic,
 * dependency-free, and good enough for the human-facing `autoviral comp
 * diff` output. The CLI never tries to *apply* this diff — it's display
 * only.
 */
export function unifiedDiff(
  before: string,
  after: string,
  beforeName: string,
  afterName: string,
): string {
  if (before === after) return "";
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  // Trim common prefix.
  let head = 0;
  while (
    head < beforeLines.length &&
    head < afterLines.length &&
    beforeLines[head] === afterLines[head]
  ) {
    head += 1;
  }

  // Trim common suffix.
  let tail = 0;
  while (
    tail < beforeLines.length - head &&
    tail < afterLines.length - head &&
    beforeLines[beforeLines.length - 1 - tail] ===
      afterLines[afterLines.length - 1 - tail]
  ) {
    tail += 1;
  }

  const beforeChunk = beforeLines.slice(head, beforeLines.length - tail);
  const afterChunk = afterLines.slice(head, afterLines.length - tail);

  // Include up to 3 lines of context on each side for readability.
  const ctx = 3;
  const ctxStart = Math.max(0, head - ctx);
  const ctxEndBefore = Math.min(beforeLines.length, beforeLines.length - tail + ctx);
  const ctxEndAfter = Math.min(afterLines.length, afterLines.length - tail + ctx);

  const preContext = beforeLines.slice(ctxStart, head);
  const postContextBefore = beforeLines.slice(beforeLines.length - tail, ctxEndBefore);
  const postContextAfter = afterLines.slice(afterLines.length - tail, ctxEndAfter);
  // Use the before-file's post-context length to bound the after-file
  // (they're identical past the suffix marker by definition).
  const postContext = postContextBefore.length >= postContextAfter.length
    ? postContextBefore
    : postContextAfter;

  const beforeStart = ctxStart + 1;
  const beforeCount = preContext.length + beforeChunk.length + postContext.length;
  const afterStart = ctxStart + 1;
  const afterCount = preContext.length + afterChunk.length + postContext.length;

  const lines: string[] = [];
  lines.push(`--- ${beforeName}`);
  lines.push(`+++ ${afterName}`);
  lines.push(`@@ -${beforeStart},${beforeCount} +${afterStart},${afterCount} @@`);
  for (const l of preContext) lines.push(` ${l}`);
  for (const l of beforeChunk) lines.push(`-${l}`);
  for (const l of afterChunk) lines.push(`+${l}`);
  for (const l of postContext) lines.push(` ${l}`);
  return lines.join("\n") + "\n";
}

// Read–modify–write helper. The mutator may return a new composition
// or mutate in place; either way we re-validate and atomically replace.
//
// S2 (US 17) — `onCommitted` fires ONLY after the atomic write succeeds.
// If the mutator or writeCompositionFor throws (validation / IO failure),
// the disk is left untouched and we never reach onCommitted — so a
// "composition-changed" broadcast wired to this callback only ever fires
// when the on-disk state genuinely changed. This is the explicit write-path
// signal that replaces the fragile fs.watch (silent on missing dirs, flaky
// on macOS atomic-rename events). composition-ops intentionally does NOT
// import uiEventBus — onCommitted is a plain callback so this low-level IO
// module stays decoupled from the event bus; routes.ts supplies the
// broadcast closure.
export async function mutateCompositionFor(
  ctx: OpsContext,
  mutator: (comp: Composition) => Composition,
  onCommitted?: (next: Composition) => void,
): Promise<Composition> {
  const current = await readCompositionFor(ctx);
  const next = mutator(current);
  await writeCompositionFor(ctx, next);
  // S2 hardening — the write already landed (atomic rename above). onCommitted
  // is a fire-and-forget broadcast hook; a failure inside it must NEVER turn a
  // successful on-disk write into a rejected mutate (which would surface as a
  // 400/500 at the route — a response that lies about a write that succeeded).
  // onCommitted MUST NOT throw, but we defend anyway so a future broadcast
  // closure can't invalidate a committed write.
  try {
    onCommitted?.(next);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[composition-ops] onCommitted broadcast failed (write already landed, non-fatal): ${
        (err as Error).message
      }`,
    );
  }
  return next;
}

// S13 (US 11/12) — dry-run preview at the write chokepoint. Reads the current
// composition, runs the SAME mutator the live path would, then PREFLIGHTS the
// result — but deliberately SKIPS writeCompositionFor (no disk touch) AND skips
// onCommitted (no broadcast). One helper covers every write verb: any route can
// dry-run by swapping mutateCompositionFor → dryRunMutate. The verdict mirrors
// the pure `preflight` shape so the CLI/agent gets the same {ok,errors,warnings}
// whether it validated a hand-built comp (/comp/validate) or previewed a verb.
//
// `onCommitted` is accepted only so callers can pass the SAME closure they use
// for the live path without branching; it is NEVER invoked in dry-run.
export async function dryRunMutate(
  ctx: OpsContext,
  mutator: (comp: Composition) => Composition,
  _onCommitted?: (next: Composition) => void,
): Promise<PreflightResult> {
  const current = await readCompositionFor(ctx);
  // The mutator may throw (e.g. a CompositionOpError for an invalid op) — let
  // that propagate; the route maps it to its code, same as the live path.
  const candidate = mutator(current);
  // PURE, IO-free verdict. No write, no broadcast. `_onCommitted` is
  // intentionally untouched in dry-run mode.
  return preflight(candidate);
}

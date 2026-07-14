// src/server/generation-resilience.ts
//
// S10 (PRD-0014) — generation韧性. Two orthogonal concerns share this module
// because they both wrap the generation route family:
//
//   ① Request-abort → cancel the upstream provider job. When the client
//      disconnects (or explicitly aborts), the route passes its AbortSignal to
//      the provider. A provider that CAN cancel aborts its own in-flight fetch;
//      one that has already ENQUEUED a billed job it can't recall (Seedance's
//      async poll API) throws OrphanedGenerationError so the route can book an
//      orphaned note in the cost-ledger instead of silently double-charging on
//      the retry. Mirrors #63 `cancelInFlightRenders` — stop the upstream work
//      BEFORE releasing, never after.
//
//   ② Batch-generation manifest — a per-work `generation-manifest.json` keyed by
//      the CONTENT hash of (prompt + params). The generation entry point reserves
//      before dispatch: a `done` key skips (returns the cached asset), an
//      `in-flight` key is rejected (no concurrent duplicate下单), a `failed`/absent
//      key proceeds (retry allowed). The key is content-addressed — NEVER a
//      timestamp — so the same request is idempotent across time. All manifest
//      mutations for one work are serialized through a per-workDir promise chain
//      so the concurrency race (two identical requests arriving together) resolves
//      to exactly one dispatch.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

// ── Abort / orphan error vocabulary ──────────────────────────────────────────

/**
 * The request was aborted BEFORE the provider dispatched anything billable
 * (e.g. the signal was already aborted at entry, or the enqueue fetch itself was
 * cancelled). Nothing was charged — the route just stops, no ledger note.
 */
export class GenerationAbortedError extends Error {
  readonly code = "GENERATION_CANCELLED" as const;
  readonly orphaned = false as const;
  constructor(message = "generation aborted before dispatch") {
    super(message);
    this.name = "GenerationAbortedError";
  }
}

/**
 * The request was aborted AFTER an upstream job was enqueued (and therefore
 * billed) but before it could be retrieved — the async provider (Seedance's
 * poll API) has no cancel endpoint, so the job is abandoned. The route records
 * an ORPHANED note in the cost-ledger so the spend is visible and the operator
 * knows a paid job was left running.
 */
export class OrphanedGenerationError extends Error {
  readonly code = "GENERATION_ORPHANED" as const;
  readonly orphaned = true as const;
  readonly providerJobId?: string;
  readonly costUsd?: number;
  constructor(args: { providerJobId?: string; costUsd?: number; message?: string } = {}) {
    super(args.message ?? "generation aborted after dispatch; upstream job orphaned");
    this.name = "OrphanedGenerationError";
    this.providerJobId = args.providerJobId;
    this.costUsd = args.costUsd;
  }
}

/** True for any abort-shaped error the route should treat as a cancellation
 *  (our two typed errors + a raw fetch AbortError/DOMException). */
export function isAbortError(err: unknown): boolean {
  if (err instanceof GenerationAbortedError || err instanceof OrphanedGenerationError) {
    return true;
  }
  if (err instanceof Error && err.name === "AbortError") return true;
  return (
    typeof DOMException !== "undefined" &&
    err instanceof DOMException &&
    err.name === "AbortError"
  );
}

/** Narrows an abort to the orphaned (billed-but-abandoned) case. */
export function isOrphanedGeneration(err: unknown): err is OrphanedGenerationError {
  return err instanceof OrphanedGenerationError;
}

// ── Content-addressed manifest ───────────────────────────────────────────────

export type ManifestStatus = "in-flight" | "done" | "failed";

export interface ManifestEntry {
  key: string;
  status: ManifestStatus;
  /** Work-relative (or absolute) path of the produced asset — set on `done`. */
  assetPath?: string;
  /** The full JSON response the route returned on the original success, so a
   *  skip echoes byte-identical output (idempotent). */
  response?: unknown;
  updatedAt: string;
}

export type Manifest = Record<string, ManifestEntry>;

export const MANIFEST_FILE = "generation-manifest.json";

/** Deterministic JSON with sorted object keys + `undefined` dropped, so param
 *  ordering and optional-spread gaps never change the hash. Arrays keep order. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * Content-addressed manifest key: sha256 of the canonical JSON of
 * `{ prompt, params }`. Order-independent, time-invariant. The slice禁 forbids a
 * timestamp key — that would defeat idempotency (every retry a fresh key).
 */
export function manifestKey(input: { prompt: string; params?: Record<string, unknown> }): string {
  const canonical = canonicalJson({ prompt: input.prompt, params: input.params ?? {} });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

// Per-workDir promise chain — serializes every read-modify-write of one work's
// manifest so a concurrent reserve/complete/fail can't clobber a sibling write
// AND so two identical reserves resolve to exactly one `proceed`.
const workChains = new Map<string, Promise<unknown>>();

function withWorkLock<T>(workDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = workChains.get(workDir) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  // Keep the chain alive regardless of this op's outcome.
  workChains.set(
    workDir,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function readManifest(workDir: string): Promise<Manifest> {
  try {
    const raw = await readFile(join(workDir, MANIFEST_FILE), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Manifest;
    }
    return {};
  } catch {
    // Missing / unreadable / corrupt → treat as empty (fresh work).
    return {};
  }
}

async function writeManifest(workDir: string, manifest: Manifest): Promise<void> {
  await mkdir(workDir, { recursive: true });
  await writeFile(join(workDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), "utf-8");
}

export type ReserveDecision =
  | { decision: "skip"; entry: ManifestEntry }
  | { decision: "reject"; entry: ManifestEntry }
  | { decision: "proceed"; key: string };

/**
 * Claim a generation slot for `key`, atomically deciding whether to dispatch:
 *   - `done`      → skip (caller returns `entry.response` verbatim; no dispatch)
 *   - `in-flight` → reject (a concurrent/duplicate request already下单)
 *   - `failed` / absent → proceed (writes an in-flight entry; caller dispatches)
 *
 * Serialized per workDir so concurrent identical reserves collapse to one
 * `proceed`. On `proceed` the caller MUST eventually call completeGeneration
 * (success) or failGeneration (error/abort) to release the in-flight lock.
 */
export function reserveGeneration(workDir: string, key: string): Promise<ReserveDecision> {
  return withWorkLock(workDir, async (): Promise<ReserveDecision> => {
    const manifest = await readManifest(workDir);
    const entry = manifest[key];
    if (entry?.status === "done") return { decision: "skip", entry };
    if (entry?.status === "in-flight") return { decision: "reject", entry };
    manifest[key] = { key, status: "in-flight", updatedAt: new Date().toISOString() };
    await writeManifest(workDir, manifest);
    return { decision: "proceed", key };
  });
}

/** Mark a reserved key done, caching the asset path + response for future skips. */
export function completeGeneration(
  workDir: string,
  key: string,
  data: { assetPath?: string; response?: unknown },
): Promise<void> {
  return withWorkLock(workDir, async () => {
    const manifest = await readManifest(workDir);
    manifest[key] = {
      key,
      status: "done",
      updatedAt: new Date().toISOString(),
      ...(data.assetPath !== undefined ? { assetPath: data.assetPath } : {}),
      ...(data.response !== undefined ? { response: data.response } : {}),
    };
    await writeManifest(workDir, manifest);
  });
}

/** Mark a reserved key failed so a later retry is allowed to proceed. */
export function failGeneration(workDir: string, key: string): Promise<void> {
  return withWorkLock(workDir, async () => {
    const manifest = await readManifest(workDir);
    manifest[key] = { key, status: "failed", updatedAt: new Date().toISOString() };
    await writeManifest(workDir, manifest);
  });
}

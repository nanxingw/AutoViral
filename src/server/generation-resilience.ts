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

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

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

export type ManifestStatus = "in-flight" | "done" | "failed" | "orphaned";

export interface ManifestEntry {
  key: string;
  status: ManifestStatus;
  /** Work-relative (or absolute) path of the produced asset — set on `done`. */
  assetPath?: string;
  /** The full JSON response the route returned on the original success, so a
   *  skip echoes byte-identical output (idempotent). */
  response?: unknown;
  /** F1 — on `orphaned`: the abandoned upstream job id (when the provider knew
   *  it) so the operator can reconcile the paid job the route stopped polling. */
  providerJobId?: string;
  /** F1 — on `orphaned`: the (known/estimated) spend of the abandoned job. */
  orphanCostUsd?: number;
  updatedAt: string;
}

export type Manifest = Record<string, ManifestEntry>;

export const MANIFEST_FILE = "generation-manifest.json";

/**
 * F8 — in-flight LEASE window. An `in-flight` entry whose `updatedAt` is older
 * than this is treated as a CRASHED holder (the process that reserved it died
 * before complete/fail could run) and is reclaimable, so a restart isn't
 * stranded on a permanent 409. It must comfortably exceed the longest legit
 * generation (Seedance polls up to ~15min) so a slow-but-live job is never
 * stolen. NOTE: this applies ONLY to `in-flight`; an `orphaned` entry is a
 * deliberate lock (a paid upstream job may still be running) and is NEVER
 * auto-released by staleness.
 */
export const IN_FLIGHT_LEASE_MS = 30 * 60 * 1000; // 30 minutes

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
  // F6 — FAIL CLOSED. Only a genuinely ABSENT file is an empty (fresh) manifest.
  // Swallowing a permission error / corrupt JSON as "empty" would silently
  // forget existing done/in-flight/orphaned state and let a paid job be
  // re-下单 — the exact double-charge the slice forbids. Anything but ENOENT
  // propagates so the route surfaces the error instead of paying twice.
  let raw: string;
  try {
    raw = await readFile(join(workDir, MANIFEST_FILE), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return {};
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `generation-manifest.json at ${workDir} is corrupt (unparseable JSON): ${(err as Error).message}`,
    );
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Manifest;
  }
  throw new Error(`generation-manifest.json at ${workDir} is not a JSON object`);
}

async function writeManifest(workDir: string, manifest: Manifest): Promise<void> {
  // F6 — ATOMIC replace. Write to a unique temp sibling then rename over the
  // target: a crash mid-write leaves the PREVIOUS manifest intact rather than a
  // truncated file that readManifest would (now) reject. rename is atomic on the
  // same filesystem, so a concurrent reader never observes a partial file.
  await mkdir(workDir, { recursive: true });
  const target = join(workDir, MANIFEST_FILE);
  const tmp = `${target}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`;
  await writeFile(tmp, JSON.stringify(manifest, null, 2), "utf-8");
  await rename(tmp, target);
}

export type RejectReason = "in-flight" | "orphaned";

export type ReserveDecision =
  | { decision: "skip"; entry: ManifestEntry }
  | { decision: "reject"; entry: ManifestEntry; reason: RejectReason }
  | { decision: "proceed"; key: string };

/** True when an in-flight entry's lease has expired (crashed holder). */
function isStaleInFlight(entry: ManifestEntry, now: number): boolean {
  const ts = Date.parse(entry.updatedAt);
  return Number.isFinite(ts) && now - ts > IN_FLIGHT_LEASE_MS;
}

/**
 * Claim a generation slot for `key`, atomically deciding whether to dispatch:
 *   - `done`          → skip (caller returns `entry.response` verbatim; no dispatch)
 *   - `in-flight`     → reject `in-flight` (a concurrent/duplicate request already下单),
 *                       UNLESS the lease expired (crashed holder) → proceed (F8 recovery)
 *   - `orphaned`      → reject `orphaned` (F1: a billed upstream job the route stopped
 *                       polling may still be running — re-下单 would double-charge). NEVER
 *                       auto-released by staleness.
 *   - `failed` / absent → proceed (writes an in-flight entry; caller dispatches)
 *
 * Serialized per workDir so concurrent identical reserves collapse to one
 * `proceed`. On `proceed` the caller MUST eventually call completeGeneration
 * (success), failGeneration (retryable error/clean abort), or orphanGeneration
 * (billed-but-abandoned) to release the in-flight lock.
 */
export function reserveGeneration(workDir: string, key: string): Promise<ReserveDecision> {
  return withWorkLock(workDir, async (): Promise<ReserveDecision> => {
    const manifest = await readManifest(workDir);
    const entry = manifest[key];
    if (entry?.status === "done") return { decision: "skip", entry };
    // F1 — orphaned is a deliberate lock: refuse identical retries until the
    // upstream terminal state is reconciled (paid job may still be running).
    if (entry?.status === "orphaned") return { decision: "reject", entry, reason: "orphaned" };
    if (entry?.status === "in-flight") {
      // F8 — a fresh in-flight is a real concurrent dispatch → reject; a stale
      // one is a crashed holder → reclaim it (fall through to proceed).
      if (!isStaleInFlight(entry, Date.now())) {
        return { decision: "reject", entry, reason: "in-flight" };
      }
    }
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

/**
 * F1 — mark a reserved key ORPHANED: the request was aborted after an upstream
 * job was dispatched (and billed) but the provider has no way to recall it, so
 * the route stopped polling. Unlike `failed`, this does NOT unlock the key —
 * a subsequent identical request is rejected (reason "orphaned") instead of
 * re-下单 a fresh paid job while the abandoned one may still be running upstream.
 * The operator reconciles it out-of-band (the cost-ledger note + providerJobId).
 */
export function orphanGeneration(
  workDir: string,
  key: string,
  meta: { providerJobId?: string; costUsd?: number } = {},
): Promise<void> {
  return withWorkLock(workDir, async () => {
    const manifest = await readManifest(workDir);
    manifest[key] = {
      key,
      status: "orphaned",
      updatedAt: new Date().toISOString(),
      ...(meta.providerJobId !== undefined ? { providerJobId: meta.providerJobId } : {}),
      ...(meta.costUsd !== undefined ? { orphanCostUsd: meta.costUsd } : {}),
    };
    await writeManifest(workDir, manifest);
  });
}

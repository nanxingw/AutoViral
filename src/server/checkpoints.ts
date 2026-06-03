/**
 * Per-work yaml snapshots — a lightweight rollback safety net.
 *
 * Inspired by pneuma's shadow-git per-turn checkpoint store, but boiled
 * down to what autoviral actually needs: snapshot the deliverable file
 * (carousel.yaml or composition.yaml) into <workDir>/.snapshots/ on every
 * agent turn completion. List + restore via two HTTP endpoints. No git
 * dependency, no binary assets — just the yaml the agent edits.
 *
 * Each snapshot is `<isoTs>__<sha8>.yaml`. We dedupe on content hash so a
 * turn that didn't actually change the yaml doesn't add a row.
 */
import { readFile, writeFile, mkdir, readdir, stat, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { dataDir } from "../infra/config.js";
import { logBridge } from "../infra/logger.js";
import {
  listContentTypes,
  type ContentTypeManifest,
} from "../shared/content-types/registry.js";

const SNAPSHOT_DIR = ".snapshots";
// I06 / ADR-006 — the snapshot targets are exactly the content types'
// deliverable files (each type's one deliverable IS its one checkpoint
// target — Decision #2 collapsed `checkpointTargets` into `deliverableFile`).
// Derived from the registry so adding a content type auto-extends checkpoint
// coverage with no constant to hand-edit. The narrow string-literal union is
// preserved by typing off the manifest field, not the runtime array.
type Deliverable = ContentTypeManifest["deliverableFile"];
const DELIVERABLES: Deliverable[] = listContentTypes().map((t) => t.deliverableFile);

// #90 — user-supplied snapshot labels live in a sidecar JSON keyed by
// filename, NOT in the filename itself. The filename is a strict
// `<ts>__<sha>__<deliverable>` identifier parsed with split("__") +
// path-traversal guards; a free-text label (spaces / "__" / unicode)
// would break both the parser and the safety checks. Decoupling keeps
// labels as pure JSON values (no filesystem semantics).
const LABELS_FILE = ".labels.json";
const MAX_LABEL_LEN = 80;

export interface Checkpoint {
  /** Filename in `.snapshots/`, e.g. `2026-05-08T12-34-56Z__a1b2c3d4__carousel.yaml`. */
  file: string;
  /** Which deliverable this snapshot is for. */
  deliverable: Deliverable;
  /** ISO timestamp parsed back from the filename. */
  ts: string;
  /** First 8 chars of the content sha256. */
  sha: string;
  /** File size in bytes (cheap differential signal). */
  bytes: number;
  /** Optional user-supplied name (#90). Manual snapshots only; auto
   *  per-turn snapshots are unlabelled. */
  label?: string;
}

function shortSha(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

function snapshotsDir(workId: string): string {
  return join(dataDir, "works", workId, SNAPSHOT_DIR);
}

/** Read the filename→label sidecar map. Tolerant of missing / corrupt
 *  files — a broken labels file must never break listing or restore. */
async function readLabels(sDir: string): Promise<Record<string, string>> {
  const p = join(sDir, LABELS_FILE);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(await readFile(p, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function writeLabels(sDir: string, labels: Record<string, string>): Promise<void> {
  await writeFile(join(sDir, LABELS_FILE), JSON.stringify(labels, null, 2), "utf-8");
}

/**
 * Take a snapshot of every deliverable yaml that exists in the work dir.
 * Idempotent: if the latest snapshot already has the same sha, skip.
 * Returns the snapshots actually written.
 */
export async function createCheckpoint(
  workId: string,
  label?: string,
): Promise<Checkpoint[]> {
  const wDir = join(dataDir, "works", workId);
  if (!existsSync(wDir)) return [];
  const sDir = snapshotsDir(workId);
  await mkdir(sDir, { recursive: true });

  // #90 — normalise the optional label once. Empty/whitespace → undefined
  // (an unlabelled snapshot), and cap the length so the sidecar can't be
  // abused as unbounded storage.
  const cleanLabel = label?.trim().slice(0, MAX_LABEL_LEN) || undefined;

  const written: Checkpoint[] = [];
  for (const d of DELIVERABLES) {
    const src = join(wDir, d);
    if (!existsSync(src)) continue;
    const raw = await readFile(src, "utf-8");
    const sha = shortSha(raw);

    // Skip if the most recent snapshot of this deliverable is the same sha.
    // Cheaper than diffing — we hash on every turn anyway.
    const existing = await listCheckpoints(workId);
    const latest = existing.find((c) => c.deliverable === d);
    if (latest && latest.sha === sha) continue;

    const ts = new Date().toISOString().replace(/[.:]/g, "-");
    const file = `${ts}__${sha}__${d}`;
    const target = join(sDir, file);
    await writeFile(target, raw, "utf-8");
    const stats = await stat(target);
    written.push({
      file,
      deliverable: d,
      ts: new Date().toISOString(),
      sha,
      bytes: stats.size,
      label: cleanLabel,
    });
  }
  // #90 — persist labels for whatever we actually wrote. Dedup means an
  // unchanged yaml writes nothing, so there's no file to label (the
  // existing snapshot stands) — correct: you can't name a no-op.
  if (cleanLabel && written.length > 0) {
    const labels = await readLabels(sDir);
    for (const w of written) labels[w.file] = cleanLabel;
    await writeLabels(sDir, labels);
  }
  if (written.length > 0) {
    logBridge("checkpoint_written", workId, {
      count: written.length,
      shas: written.map((w) => w.sha).join(","),
      labelled: cleanLabel ? "1" : "0",
    });
  }
  return written;
}

/**
 * List checkpoints for a work, newest first. Filename is the source of
 * truth for ts/sha/deliverable — the directory is otherwise opaque.
 */
export async function listCheckpoints(workId: string): Promise<Checkpoint[]> {
  const sDir = snapshotsDir(workId);
  if (!existsSync(sDir)) return [];
  const files = await readdir(sDir);
  // #90 — sidecar labels (the `.labels.json` entry itself has no "__" so it
  // never parses as a checkpoint below).
  const labels = await readLabels(sDir);
  const out: Checkpoint[] = [];
  for (const f of files) {
    // <ts>__<sha>__<deliverable>
    const parts = f.split("__");
    if (parts.length !== 3) continue;
    const [ts, sha, deliverable] = parts;
    if (!DELIVERABLES.includes(deliverable as Deliverable)) continue;
    try {
      const stats = await stat(join(sDir, f));
      out.push({
        file: f,
        deliverable: deliverable as Deliverable,
        // Filename ts had `:` and `.` replaced for filesystem safety —
        // restore them best-effort. Consumers treat this as informational.
        ts: ts.replace(/(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d+)Z/, "$1:$2:$3.$4Z"),
        sha,
        bytes: stats.size,
        label: labels[f],
      });
    } catch {
      // file vanished mid-listing — skip silently
    }
  }
  return out.sort((a, b) => b.file.localeCompare(a.file));
}

/**
 * Restore a checkpoint by filename. Overwrites the corresponding live
 * deliverable. Caller is responsible for nudging the frontend to reload.
 *
 * Returns `preRestoreSnapshot`: the snapshot we took of the CURRENT live state
 * just before overwriting it (null if current state was already captured), so
 * the caller can tell the user the restore is reversible.
 */
export async function restoreCheckpoint(
  workId: string,
  file: string,
): Promise<{ deliverable: Deliverable; preRestoreSnapshot: Checkpoint | null } | null> {
  // Parse + validate filename so a bad path can't escape .snapshots/.
  if (file.includes("/") || file.includes("\\") || file.includes("..")) return null;
  const parts = file.split("__");
  if (parts.length !== 3) return null;
  const deliverable = parts[2] as Deliverable;
  if (!DELIVERABLES.includes(deliverable)) return null;

  const wDir = join(dataDir, "works", workId);
  const src = join(snapshotsDir(workId), file);
  if (!existsSync(src)) return null;

  // #68 — snapshot the CURRENT live state BEFORE overwriting it. Restoring an
  // old snapshot is itself a destructive write, and the autosave path
  // (PUT /composition) does NOT checkpoint — a user's manual edits live ONLY in
  // the live yaml. Without this pre-snapshot, restore would silently overwrite
  // and permanently lose those edits, with nothing to roll back to. Taking it
  // here makes restore reversible. createCheckpoint dedupes on content sha, so
  // it's a no-op when nothing has changed and a lifesaver when edits are
  // pending. We must NOT swallow its errors (unlike the fire-and-forget
  // per-turn checkpoint in ws-bridge): if we can't preserve the current state,
  // we abort the restore rather than destroy it.
  const preRestore = await createCheckpoint(workId);
  const preRestoreSnapshot = preRestore.find((c) => c.deliverable === deliverable) ?? null;

  const target = join(wDir, deliverable);
  await copyFile(src, target);
  logBridge("checkpoint_restored", workId, {
    file,
    deliverable,
    preRestoreSha: preRestoreSnapshot?.sha ?? "unchanged",
  });
  return { deliverable, preRestoreSnapshot };
}

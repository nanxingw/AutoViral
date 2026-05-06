// src/server/clip-index.ts
//
// Phase 8.1.B — Node bridge to the Python CLIP scripts in
// `skills/autoviral/modules/research/scripts/clip_index/`.
//
// Three responsibilities:
//   * `buildClipIndex(workId)` — collect indexable assets, write a temp JSON,
//      invoke `build_index.py`, clean up.
//   * `searchClipIndex(workId, query, topK)` — invoke `search.py` against the
//      per-work index dir.
//   * `getClipIndexStatus(workId)` — read meta.json (or report no_index).
//
// All three propagate stub-mode payloads from Python verbatim (D4).

import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

import { runPythonScript } from "./python-bridge.js";
import { listAssets } from "../work-store.js";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repo-relative path to the Python scripts. The server's compiled output lives
// under `dist/server/` — but in dev/tests we run TS directly from `src/server/`.
// Two relative-path candidates cover both layouts; we use the first that exists.
const SCRIPT_DIR_CANDIDATES = [
  path.resolve(__dirname, "../../skills/autoviral/modules/research/scripts/clip_index"),
  path.resolve(__dirname, "../../../skills/autoviral/modules/research/scripts/clip_index"),
];

function scriptPath(name: string): string {
  for (const dir of SCRIPT_DIR_CANDIDATES) {
    const p = path.join(dir, name);
    // We don't need fs.access here — runPythonScript will surface ENOENT if
    // the path is wrong. Just pick the first candidate; the second only kicks
    // in if compiled output ever moves further down the tree.
    return p;
  }
  return path.join(SCRIPT_DIR_CANDIDATES[0], name);
}

function dataDir(): string {
  return process.env.AUTOVIRAL_DATA_DIR ?? path.join(os.homedir(), ".autoviral");
}

/** Per-work index dir: <dataDir>/works/<id>/clip-index/. */
export function clipIndexDir(workId: string): string {
  return path.join(dataDir(), "works", workId, "clip-index");
}

const VIDEO_EXT = /\.(mp4|mov|webm|m4v|mkv)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$/i;

function classifyKind(p: string): "image" | "video" | "other" {
  if (VIDEO_EXT.test(p)) return "video";
  if (IMAGE_EXT.test(p)) return "image";
  return "other";
}

export interface BuildOk {
  ok: true;
  stub: false;
  assetCount: number;
  model: string;
  indexedAt: string;
  durationMs: number;
}
export interface StubResult {
  stub: true;
  reason: string;
  [k: string]: unknown;
}
export type BuildResult = BuildOk | StubResult;

export interface ClipSearchHit {
  uri: string;
  kind: "image" | "video";
  score: number;
  frameSrc?: string;
}
export interface SearchOk {
  stub: false;
  results: ClipSearchHit[];
  searchMs: number;
}
export type SearchResult = SearchOk | StubResult;

export interface StatusOk {
  stub: false;
  model: string;
  assetCount: number;
  indexedAt: string;
  embeddingDim?: number;
}
export type StatusResult = StatusOk | StubResult;

export async function buildClipIndex(workId: string): Promise<BuildResult> {
  if (!SAFE_ID.test(workId)) throw new Error("Invalid workId");

  const indexDir = clipIndexDir(workId);
  await fs.mkdir(indexDir, { recursive: true });

  const baseDir = path.join(dataDir(), "works", workId);
  const allAssets = await listAssets(workId);
  const indexable = allAssets
    .map((rel) => ({
      relPath: rel,
      absPath: path.join(baseDir, rel),
      kind: classifyKind(rel),
    }))
    .filter((a) => a.kind === "image" || a.kind === "video");

  if (indexable.length === 0) {
    return { stub: true, reason: "no_indexable_assets", assetCount: 0 };
  }

  const tempListPath = path.join(os.tmpdir(), `av-clip-asset-list-${randomUUID()}.json`);
  await fs.writeFile(tempListPath, JSON.stringify(indexable));

  const model = process.env.AUTOVIRAL_CLIP_MODEL ?? "ViT-B-32";

  try {
    return await runPythonScript<BuildResult>(
      scriptPath("build_index.py"),
      [
        "--work-id", workId,
        "--asset-list", tempListPath,
        "--out-dir", indexDir,
        "--model", model,
      ],
      { timeoutMs: 300_000 },
    );
  } finally {
    await fs.unlink(tempListPath).catch(() => { /* noop */ });
  }
}

export async function searchClipIndex(
  workId: string,
  query: string,
  topK: number,
): Promise<SearchResult> {
  if (!SAFE_ID.test(workId)) throw new Error("Invalid workId");

  const indexDir = clipIndexDir(workId);
  const model = process.env.AUTOVIRAL_CLIP_MODEL ?? "ViT-B-32";
  const k = Math.max(1, Math.min(100, Math.floor(topK) || 20));

  return await runPythonScript<SearchResult>(
    scriptPath("search.py"),
    [
      "--work-id", workId,
      "--query", query,
      "--top-k", String(k),
      "--index-dir", indexDir,
      "--model", model,
    ],
    { timeoutMs: 30_000 },
  );
}

export async function getClipIndexStatus(workId: string): Promise<StatusResult> {
  if (!SAFE_ID.test(workId)) throw new Error("Invalid workId");

  const metaPath = path.join(clipIndexDir(workId), "meta.json");
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw) as {
      model?: string;
      assetCount?: number;
      builtAt?: string;
      embeddingDim?: number;
    };
    if (!meta.model || typeof meta.assetCount !== "number" || !meta.builtAt) {
      return { stub: true, reason: "invalid_meta" };
    }
    return {
      stub: false,
      model: meta.model,
      assetCount: meta.assetCount,
      indexedAt: meta.builtAt,
      embeddingDim: meta.embeddingDim,
    };
  } catch {
    return { stub: true, reason: "no_index" };
  }
}

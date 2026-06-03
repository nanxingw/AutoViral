// src/server/clip-index.ts
//
// Removed in agentic-terminal refactor (2026-05-14). The CLIP-based asset
// search (build_index.py / search.py) lived in
// `skills/autoviral/modules/research/scripts/clip_index/` — workstation
// infrastructure mis-placed in skills/. The Python scripts are preserved
// in git tag pre-skill-rewrite-snapshot; package them as a sibling skill
// if anyone wants semantic asset search back.
//
// All three exported functions now return `{ stub: true, reason: "removed" }`
// so callers (Studio's asset search, etc.) degrade gracefully — the UI
// falls back to filename grep instead of crashing.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { listAssets } from "../domain/work-store.js";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

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
  // Keep the indexable-asset count for diagnostics so callers can show the
  // user a useful "N indexable assets, but CLIP search is disabled" hint.
  const allAssets = await listAssets(workId);
  const assetCount = allAssets.filter(
    (rel) => classifyKind(rel) !== "other",
  ).length;
  return { stub: true, reason: "clip_index_removed_in_refactor", assetCount };
}

export async function searchClipIndex(
  _workId: string,
  _query: string,
  _topK: number,
): Promise<SearchResult> {
  return { stub: true, reason: "clip_index_removed_in_refactor" };
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

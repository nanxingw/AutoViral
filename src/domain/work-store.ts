// Work store — manages persistent work (content) definitions for AutoViral.
// D3: a Work is a content piece with module-as-capability semantics — no
// stage-coupled fields. The agent owns its own progress tracking via chat.

import { readFile, writeFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import yaml from "js-yaml";
import { dataDir } from "../infra/config.js";

// ── Types ────────────────────────────────────────────────────────────────────

// I06 / ADR-006 — the content-type union is now OWNED by the registry
// (derived from its manifest ids). Imported into scope for the `Work` shape
// below AND re-exported for back-compat so every existing `WorkType` import
// from work-store keeps working with no churn. src/shared must NOT import from
// src/domain; the dependency points this way.
import type { WorkType } from "../shared/content-types/registry.js";
export type { WorkType };
export type WorkStatus = "draft" | "creating" | "ready" | "failed";

export type ContentCategory = "anxiety" | "conflict" | "comedy" | "envy" | "other";
export type VideoSource = "upload" | "search" | "ai-generate";

export interface Work {
  id: string;
  title: string;
  type: WorkType;
  contentCategory?: ContentCategory;
  videoSource?: VideoSource;
  videoSearchQuery?: string;
  status: WorkStatus;
  platforms: string[];
  cliSessionId?: string;
  coverImage?: string;
  topicHint?: string;
  createdAt: string;
  updatedAt: string;
}

/** Keys removed in D3 — silently dropped from update inputs and on read so
 *  legacy YAML files do not bleed back into the in-memory Work shape. */
const STRIP_KEYS = ["pipeline", "evaluationMode", "evalSessionIds", "evalAttempts"] as const;

/** Lightweight summary stored in the index file. */
export interface WorkSummary {
  id: string;
  title: string;
  type: WorkType;
  contentCategory?: ContentCategory;
  platforms?: string[];
  status: WorkStatus;
  updatedAt: string;
}

// ── Storage paths ────────────────────────────────────────────────────────────

const WORKS_BASE = join(dataDir, "works");
const INDEX_FILE = join(WORKS_BASE, "works.yaml");

interface WorksIndex {
  works: WorkSummary[];
}

async function ensureWorksDir(): Promise<void> {
  await mkdir(WORKS_BASE, { recursive: true });
}

// ── Index helpers ────────────────────────────────────────────────────────────

async function readIndex(): Promise<WorksIndex> {
  await ensureWorksDir();
  try {
    const raw = await readFile(INDEX_FILE, "utf-8");
    const parsed = yaml.load(raw) as WorksIndex | null;
    return parsed ?? { works: [] };
  } catch {
    return { works: [] };
  }
}

async function writeIndex(data: WorksIndex): Promise<void> {
  await ensureWorksDir();
  const raw = yaml.dump(data, { lineWidth: -1 });
  await writeFile(INDEX_FILE, raw, "utf-8");
}

// ── Per-work file helpers ────────────────────────────────────────────────────

function workDir(id: string): string {
  return join(WORKS_BASE, id);
}

function workFilePath(id: string): string {
  return join(workDir(id), "work.yaml");
}

function assetsDir(id: string): string {
  return join(workDir(id), "assets");
}

function outputDir(id: string): string {
  return join(workDir(id), "output");
}

async function readWorkFile(id: string): Promise<Work | undefined> {
  try {
    const raw = await readFile(workFilePath(id), "utf-8");
    const parsed = yaml.load(raw) as (Work & Record<string, unknown>) | null;
    if (!parsed) return undefined;
    // Strip legacy stage-coupled fields on read so callers never see them.
    for (const k of STRIP_KEYS) delete (parsed as Record<string, unknown>)[k];
    return parsed as Work;
  } catch {
    return undefined;
  }
}

async function writeWorkFile(work: Work): Promise<void> {
  const dir = workDir(work.id);
  await mkdir(dir, { recursive: true });
  await mkdir(assetsDir(work.id), { recursive: true });
  const raw = yaml.dump(work, { lineWidth: -1, sortKeys: false });
  await writeFile(workFilePath(work.id), raw, "utf-8");
}

function toSummary(w: Work): WorkSummary {
  return { id: w.id, title: w.title, type: w.type, contentCategory: w.contentCategory, platforms: w.platforms, status: w.status, updatedAt: w.updatedAt };
}

// ── ID generation ────────────────────────────────────────────────────────────

function generateId(): string {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const hex = Math.random().toString(16).slice(2, 5);
  return `w_${ts}_${hex}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function listWorks(): Promise<WorkSummary[]> {
  const index = await readIndex();
  return index.works;
}

export async function getWork(id: string): Promise<Work | undefined> {
  return readWorkFile(id);
}

export async function createWork(input: {
  title: string;
  type: WorkType;
  contentCategory?: ContentCategory;
  videoSource?: VideoSource;
  videoSearchQuery?: string;
  platforms: string[];
  topicHint?: string;
}): Promise<Work> {
  const now = new Date().toISOString();
  const id = generateId();
  const work: Work = {
    id,
    title: input.title,
    type: input.type,
    contentCategory: input.contentCategory,
    videoSource: input.videoSource,
    videoSearchQuery: input.videoSearchQuery,
    status: input.videoSource === "search" ? "creating" : "draft",
    platforms: input.platforms,
    topicHint: input.topicHint,
    createdAt: now,
    updatedAt: now,
  };

  // Create workspace directories
  const wDir = join(dataDir, "works", id);
  await mkdir(join(wDir, "research"), { recursive: true });
  await mkdir(join(wDir, "plan"), { recursive: true });
  await mkdir(join(wDir, "assets", "frames"), { recursive: true });
  await mkdir(join(wDir, "assets", "clips"), { recursive: true });
  await mkdir(join(wDir, "assets", "images"), { recursive: true });
  await mkdir(join(wDir, "output"), { recursive: true });

  await writeWorkFile(work);

  // Update index
  const index = await readIndex();
  index.works.push(toSummary(work));
  await writeIndex(index);

  return work;
}

export async function updateWork(id: string, updates: Partial<Work>): Promise<Work | undefined> {
  const work = await readWorkFile(id);
  if (!work) return undefined;

  const cleaned: Record<string, unknown> = { ...(updates as Record<string, unknown>) };
  for (const k of STRIP_KEYS) delete cleaned[k];
  const updated: Work = { ...work, ...(cleaned as Partial<Work>), id, updatedAt: new Date().toISOString() };
  await writeWorkFile(updated);

  // Sync index
  const index = await readIndex();
  const idx = index.works.findIndex((w) => w.id === id);
  const summary = toSummary(updated);
  if (idx >= 0) {
    index.works[idx] = summary;
  } else {
    index.works.push(summary);
  }
  await writeIndex(index);

  return updated;
}

export async function deleteWork(id: string): Promise<boolean> {
  const index = await readIndex();
  const before = index.works.length;
  index.works = index.works.filter((w) => w.id !== id);
  if (index.works.length === before) return false;

  await writeIndex(index);

  // Remove work directory
  try {
    await rm(workDir(id), { recursive: true, force: true });
  } catch {
    // directory may already be gone
  }

  return true;
}

/** Recursively list files in assets/ and output/ dirs, returning relative paths. */
export async function listAssets(id: string): Promise<string[]> {
  const results: string[] = [];
  const baseDir = workDir(id);

  async function walk(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          results.push(relative(baseDir, fullPath));
        }
      }
    } catch {
      // directory may not exist yet
    }
  }

  await walk(join(baseDir, "assets"));
  await walk(join(baseDir, "output"));

  return results;
}

export function getAssetPath(id: string, filename: string): string {
  return join(workDir(id), filename);
}

/** Save full conversation to chat.json (single file per work). */
export async function saveWorkChat(id: string, data: unknown): Promise<void> {
  await writeFile(join(workDir(id), "chat.json"), JSON.stringify(data), "utf-8");
}

/** Load full conversation. Tries chat.json (single-shot snapshot saved by
 *  PUT /api/works/:id/chat) first, falling back to chat.jsonl (the live
 *  stream log appended by ws-bridge.appendToChatLog). Without the jsonl
 *  fallback, refreshing the studio page wiped the entire visible chat
 *  history because no caller actually writes chat.json today — only the
 *  jsonl path is on disk for live work sessions. */
export async function loadWorkChat(
  id: string,
): Promise<{ blocks: unknown[] } | null> {
  try {
    const raw = await readFile(join(workDir(id), "chat.json"), "utf-8");
    return JSON.parse(raw) as { blocks: unknown[] };
  } catch {
    /* fall through to jsonl */
  }
  try {
    const raw = await readFile(join(workDir(id), "chat.jsonl"), "utf-8");
    const blocks = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((line) => {
        try {
          const b = JSON.parse(line) as Record<string, unknown>;
          // Normalize ISO timestamp → ms epoch so the client's hydration
          // path (which expects b.ts: number) shows real timestamps
          // instead of fabricated `Date.now() - i*1000` values.
          if (typeof b.timestamp === "string" && b.ts === undefined) {
            const t = Date.parse(b.timestamp);
            if (!Number.isNaN(t)) b.ts = t;
          }
          return b;
        } catch {
          return null;
        }
      })
      .filter((b): b is Record<string, unknown> => b !== null);
    if (blocks.length === 0) return null;
    return { blocks };
  } catch {
    return null;
  }
}

// Evaluation result helpers were removed in the D3 cleanup — the evaluator was
// demoted from a gate to a read-only rubric tool (GET /api/works/:id/rubric/:module),
// so per-step EvalResult persistence has no consumer. Removed by Codex review
// follow-up 2026-04-27. If a future feature needs to log evaluator scores, add
// it back through a fresh, deliberate path (e.g. a single eval-log.jsonl).

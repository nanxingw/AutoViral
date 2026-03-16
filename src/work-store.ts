// Work store — manages persistent work (content) definitions for AutoViral
// Each work is a content piece flowing through a pipeline from idea to published.

import { readFile, writeFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";

// ── Types ────────────────────────────────────────────────────────────────────

export type WorkType = "short-video" | "image-text" | "long-video" | "livestream";
export type WorkStatus = "draft" | "creating" | "ready" | "publishing" | "published" | "failed";

export interface PipelineStep {
  name: string;
  status: "pending" | "active" | "done" | "skipped";
  startedAt?: string;
  completedAt?: string;
  note?: string;
}

export interface MetricsSnapshot {
  platform: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  collectedAt: string;
}

export interface PlatformEntry {
  platform: string;
  publishedUrl?: string;
  publishedAt?: string;
  metrics?: MetricsSnapshot[];
}

export interface Work {
  id: string;
  title: string;
  type: WorkType;
  status: WorkStatus;
  platforms: PlatformEntry[];
  pipeline: Record<string, PipelineStep>;
  cliSessionId?: string;
  coverImage?: string;
  topicHint?: string;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight summary stored in the index file. */
export interface WorkSummary {
  id: string;
  title: string;
  type: WorkType;
  status: WorkStatus;
  updatedAt: string;
}

// ── Storage paths ────────────────────────────────────────────────────────────

const WORKS_BASE = join(homedir(), ".skill-evolver", "works");
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

async function readWorkFile(id: string): Promise<Work | undefined> {
  try {
    const raw = await readFile(workFilePath(id), "utf-8");
    return yaml.load(raw) as Work;
  } catch {
    return undefined;
  }
}

async function writeWorkFile(work: Work): Promise<void> {
  const dir = workDir(work.id);
  await mkdir(dir, { recursive: true });
  await mkdir(assetsDir(work.id), { recursive: true });
  const raw = yaml.dump(work, { lineWidth: -1 });
  await writeFile(workFilePath(work.id), raw, "utf-8");
}

function toSummary(w: Work): WorkSummary {
  return { id: w.id, title: w.title, type: w.type, status: w.status, updatedAt: w.updatedAt };
}

// ── Pipeline templates ───────────────────────────────────────────────────────

function defaultPipeline(type: WorkType): Record<string, PipelineStep> {
  const step = (name: string): PipelineStep => ({ name, status: "pending" });

  switch (type) {
    case "short-video":
      return {
        research: step("Topic Research"),
        script: step("Script Writing"),
        shoot: step("Shooting"),
        edit: step("Editing"),
        thumbnail: step("Thumbnail & Caption"),
        publish: step("Publish"),
      };
    case "long-video":
      return {
        research: step("Topic Research"),
        outline: step("Outline & Structure"),
        script: step("Script Writing"),
        production: step("Production"),
        edit: step("Post-production"),
        publish: step("Publish"),
      };
    case "image-text":
      return {
        research: step("Topic Research"),
        draft: step("Draft Writing"),
        visuals: step("Visual Design"),
        review: step("Review & Polish"),
        seo: step("SEO & Tags"),
        publish: step("Publish"),
      };
    case "livestream":
      return {
        research: step("Topic Research"),
        outline: step("Run-of-Show"),
        assets: step("Overlays & Assets"),
        rehearsal: step("Rehearsal"),
        broadcast: step("Go Live"),
        recap: step("Recap & Clips"),
      };
  }
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
  platforms: string[];
  topicHint?: string;
}): Promise<Work> {
  const now = new Date().toISOString();
  const work: Work = {
    id: generateId(),
    title: input.title,
    type: input.type,
    status: "draft",
    platforms: input.platforms.map((p) => ({ platform: p })),
    pipeline: defaultPipeline(input.type),
    topicHint: input.topicHint,
    createdAt: now,
    updatedAt: now,
  };

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

  const updated: Work = { ...work, ...updates, id, updatedAt: new Date().toISOString() };
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

export async function listAssets(id: string): Promise<string[]> {
  const dir = assetsDir(id);
  try {
    await mkdir(dir, { recursive: true });
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function getAssetPath(id: string, filename: string): string {
  return join(assetsDir(id), filename);
}

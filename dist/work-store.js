// Work store — manages persistent work (content) definitions for AutoViral
// Each work is a content piece flowing through a 4-step pipeline.
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import yaml from "js-yaml";
import { dataDir } from "./config.js";
// ── Storage paths ────────────────────────────────────────────────────────────
const WORKS_BASE = join(dataDir, "works");
const INDEX_FILE = join(WORKS_BASE, "works.yaml");
async function ensureWorksDir() {
    await mkdir(WORKS_BASE, { recursive: true });
}
// ── Index helpers ────────────────────────────────────────────────────────────
async function readIndex() {
    await ensureWorksDir();
    try {
        const raw = await readFile(INDEX_FILE, "utf-8");
        const parsed = yaml.load(raw);
        return parsed ?? { works: [] };
    }
    catch {
        return { works: [] };
    }
}
async function writeIndex(data) {
    await ensureWorksDir();
    const raw = yaml.dump(data, { lineWidth: -1 });
    await writeFile(INDEX_FILE, raw, "utf-8");
}
// ── Per-work file helpers ────────────────────────────────────────────────────
function workDir(id) {
    return join(WORKS_BASE, id);
}
function workFilePath(id) {
    return join(workDir(id), "work.yaml");
}
function assetsDir(id) {
    return join(workDir(id), "assets");
}
function outputDir(id) {
    return join(workDir(id), "output");
}
async function readWorkFile(id) {
    try {
        const raw = await readFile(workFilePath(id), "utf-8");
        const work = yaml.load(raw);
        // Repair pipeline: ensure all expected steps exist (fixes previously corrupted data)
        if (work && work.pipeline && work.type) {
            const template = defaultPipeline(work.type, work.videoSource);
            let repaired = false;
            for (const [key, step] of Object.entries(template)) {
                if (!work.pipeline[key]) {
                    // Missing step — add it as done if later steps exist and are done, otherwise pending
                    const templateKeys = Object.keys(template);
                    const missingIdx = templateKeys.indexOf(key);
                    const laterSteps = templateKeys.slice(missingIdx + 1);
                    const hasLaterDone = laterSteps.some(k => work.pipeline[k]?.status === "done");
                    work.pipeline[key] = { ...step, status: hasLaterDone ? "done" : "pending" };
                    repaired = true;
                }
                else if (!work.pipeline[key].name && step.name) {
                    // Existing step missing name — restore from template
                    work.pipeline[key].name = step.name;
                    repaired = true;
                }
            }
            if (repaired) {
                // Reorder pipeline to match template order
                const templateKeys = Object.keys(template);
                const ordered = {};
                for (const key of templateKeys) {
                    if (work.pipeline[key])
                        ordered[key] = work.pipeline[key];
                }
                // Keep any extra steps not in template
                for (const [key, step] of Object.entries(work.pipeline)) {
                    if (!ordered[key])
                        ordered[key] = step;
                }
                work.pipeline = ordered;
                // Persist the repair
                writeWorkFile(work).catch(() => { });
            }
        }
        return work;
    }
    catch {
        return undefined;
    }
}
async function writeWorkFile(work) {
    const dir = workDir(work.id);
    await mkdir(dir, { recursive: true });
    await mkdir(assetsDir(work.id), { recursive: true });
    const raw = yaml.dump(work, { lineWidth: -1, sortKeys: false });
    await writeFile(workFilePath(work.id), raw, "utf-8");
}
function toSummary(w) {
    return { id: w.id, title: w.title, type: w.type, contentCategory: w.contentCategory, platforms: w.platforms, status: w.status, updatedAt: w.updatedAt };
}
// ── Pipeline templates ───────────────────────────────────────────────────────
function defaultPipeline(type, videoSource) {
    const result = {};
    // Prepend material-search step if user chose web search for video source
    if (type === "short-video" && videoSource === "search") {
        result["material-search"] = { name: "素材搜索", status: "active", startedAt: new Date().toISOString() };
    }
    const names = {
        "short-video": { research: "话题调研", plan: "分镜规划", assembly: "视频合成" },
        "image-text": { research: "话题调研", plan: "内容规划", assets: "图片生成", assembly: "图文排版" },
    };
    for (const [key, name] of Object.entries(names[type])) {
        result[key] = { name, status: "pending" };
    }
    return result;
}
// ── ID generation ────────────────────────────────────────────────────────────
function generateId() {
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const hex = Math.random().toString(16).slice(2, 5);
    return `w_${ts}_${hex}`;
}
// ── Public API ───────────────────────────────────────────────────────────────
export async function listWorks() {
    const index = await readIndex();
    return index.works;
}
export async function getWork(id) {
    return readWorkFile(id);
}
export async function createWork(input) {
    const now = new Date().toISOString();
    const id = generateId();
    const work = {
        id,
        title: input.title,
        type: input.type,
        contentCategory: input.contentCategory,
        videoSource: input.videoSource,
        videoSearchQuery: input.videoSearchQuery,
        status: input.videoSource === "search" ? "creating" : "draft",
        platforms: input.platforms,
        pipeline: defaultPipeline(input.type, input.videoSource),
        topicHint: input.topicHint,
        language: input.language,
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
export async function updateWork(id, updates) {
    const work = await readWorkFile(id);
    if (!work)
        return undefined;
    // Deep-merge pipeline: update individual steps instead of replacing the whole object
    let mergedPipeline = work.pipeline;
    if (updates.pipeline) {
        mergedPipeline = { ...work.pipeline };
        for (const [key, stepUpdate] of Object.entries(updates.pipeline)) {
            mergedPipeline[key] = mergedPipeline[key]
                ? { ...mergedPipeline[key], ...stepUpdate }
                : stepUpdate;
        }
    }
    const updated = { ...work, ...updates, pipeline: mergedPipeline, id, updatedAt: new Date().toISOString() };
    await writeWorkFile(updated);
    // Sync index
    const index = await readIndex();
    const idx = index.works.findIndex((w) => w.id === id);
    const summary = toSummary(updated);
    if (idx >= 0) {
        index.works[idx] = summary;
    }
    else {
        index.works.push(summary);
    }
    await writeIndex(index);
    return updated;
}
export async function deleteWork(id) {
    const index = await readIndex();
    const before = index.works.length;
    index.works = index.works.filter((w) => w.id !== id);
    if (index.works.length === before)
        return false;
    await writeIndex(index);
    // Remove work directory
    try {
        await rm(workDir(id), { recursive: true, force: true });
    }
    catch {
        // directory may already be gone
    }
    return true;
}
/** Recursively list files in assets/ and output/ dirs, returning relative paths. */
export async function listAssets(id) {
    const results = [];
    const baseDir = workDir(id);
    async function walk(dir) {
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(fullPath);
                }
                else {
                    results.push(relative(baseDir, fullPath));
                }
            }
        }
        catch {
            // directory may not exist yet
        }
    }
    await walk(join(baseDir, "assets"));
    await walk(join(baseDir, "output"));
    await walk(join(baseDir, "output_en"));
    return results;
}
export function getAssetPath(id, filename) {
    return join(workDir(id), filename);
}
/** Save execution history for a pipeline step. */
export async function saveStepHistory(id, stepKey, data) {
    const stepsDir = join(workDir(id), "steps");
    await mkdir(stepsDir, { recursive: true });
    await writeFile(join(stepsDir, `${stepKey}.json`), JSON.stringify(data, null, 2), "utf-8");
}
/** Load execution history for a pipeline step. */
export async function loadStepHistory(id, stepKey) {
    try {
        const raw = await readFile(join(workDir(id), "steps", `${stepKey}.json`), "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Save full conversation to chat.json (single file per work). */
export async function saveWorkChat(id, data) {
    await writeFile(join(workDir(id), "chat.json"), JSON.stringify(data), "utf-8");
}
/** Load full conversation from chat.json. */
export async function loadWorkChat(id) {
    try {
        const raw = await readFile(join(workDir(id), "chat.json"), "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=work-store.js.map
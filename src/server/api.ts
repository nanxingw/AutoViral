import { Hono } from "hono";
import { readFile, writeFile, appendFile, mkdir, readdir, rename, copyFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, extname } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { loadConfig, saveConfig, dataDir, repoRoot } from "../config.js";
import {
  listWorks, getWork, createWork as storeCreateWork,
  updateWork as storeUpdateWork, deleteWork as storeDeleteWork,
  listAssets, getAssetPath,
  saveWorkChat,
} from "../work-store.js";
import { MemoryClient } from "../memory.js";
import type { WsBridge } from "../ws-bridge.js";
import type { RenderQueue } from "./render-queue/index.js";
import { getProvider, getDefaultProvider, listProviders } from "../providers/registry.js";
import {
  getProvider as getVideoProvider,
  listProviders as listVideoProviders,
} from "./providers/registry.js";
import { listSharedAssetsWithMeta, getSharedAssetPath, validateCategory, sanitizeFilename, saveSharedAsset, deleteSharedAsset, moveSharedAsset } from "../shared-assets.js";
import { getLatestCreatorData, getCreatorHistory } from "../analytics-collector.js";
import { log, readLogs } from "../logger.js";
import { runPipeline, getRunStatus, listRuns, getRunReport, type RunConfig } from "../test-runner.js";
import { evaluateWork } from "../test-evaluator.js";
import { analyzeAudio, mixAudioTracks } from "../audio-tools.js";
import { pickProvider } from "../tts-providers/registry.js";
import { resolveAssetPath, resolveAssetSubpath, UnsafePathError, SAFE_ID } from "./safe-paths.js";
import { listCheckpoints, restoreCheckpoint, createCheckpoint } from "./checkpoints.js";
import {
  type Composition,
  type AssetEntry,
  type ProvenanceEdge,
  CompositionSchema,
} from "../shared/composition.js";
import { z } from "zod";
import { tmpdir } from "node:os";
import { runPythonScript } from "./python-bridge.js";
import { interpolateProcessor } from "./post-process/interpolate.js";
import { superResolveProcessor } from "./post-process/super-resolve.js";
import { lipSyncProcessor } from "./post-process/lip-sync.js";
import type { PostProcessor, PostProcessOptions } from "./post-process/types.js";

export const apiRoutes = new Hono();

// ── Python script runner for real-time trend data ────────────────────────────

const execFileAsync = promisify(execFile);

async function runTrendScript(platform: string): Promise<string> {
  const scriptsDir = join(process.cwd(), 'skills', 'autoviral', 'modules', 'research', 'scripts');

  try {
    if (platform === 'douyin') {
      const { stdout } = await execFileAsync('python3', [
        join(scriptsDir, 'douyin_hot_search.py'), '--top', '30'
      ], { timeout: 30000 });
      return stdout;
    }
    // Other platforms via newsnow
    const { stdout } = await execFileAsync('python3', [
      join(scriptsDir, 'newsnow_trends.py'), platform, '--top', '20'
    ], { timeout: 30000 });
    return stdout;
  } catch (err) {
    console.error(`[trends] Script error for ${platform}:`, err);
    return '';
  }
}

// ── MIME type helper ────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
};

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// ── WsBridge accessor (set by server/index.ts after construction) ─────────
let wsBridge: WsBridge | null = null;

export function setWsBridge(bridge: WsBridge): void {
  wsBridge = bridge;
}

// ── RenderQueue accessor (set by server/index.ts after construction) ──────
// Phase 7.B — POST /api/works/:id/render now enqueues into this queue
// instead of running the pipeline synchronously.
let renderQueue: RenderQueue | null = null;

export function setRenderQueue(q: RenderQueue | null): void {
  renderQueue = q;
}

// ── Status & Config ─────────────────────────────────────────────────────────

// GET /api/status
apiRoutes.get("/api/status", async (c) => {
  const config = await loadConfig();
  return c.json({
    state: "idle",
    model: config.model,
    port: config.port,
  });
});

// GET /api/config
apiRoutes.get("/api/config", async (c) => {
  const config = await loadConfig();
  return c.json({
    ...config,
    jimengAccessKey: config.jimeng?.accessKey ?? "",
    jimengSecretKey: config.jimeng?.secretKey ?? "",
    openrouterKey: config.openrouter?.apiKey ?? "",
    douyinUrl: config.analytics?.douyinUrl ?? "",
    memorySyncEnabled: config.memory?.syncEnabled ?? false,
  });
});

// PUT /api/config
apiRoutes.put("/api/config", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const config = await loadConfig();

  // Map flat frontend fields to nested config structure
  if (body.jimengAccessKey !== undefined) {
    if (!config.jimeng) config.jimeng = { accessKey: "", secretKey: "" };
    config.jimeng.accessKey = body.jimengAccessKey as string;
  }
  if (body.jimengSecretKey !== undefined) {
    if (!config.jimeng) config.jimeng = { accessKey: "", secretKey: "" };
    config.jimeng.secretKey = body.jimengSecretKey as string;
  }
  if (body.openrouterKey !== undefined) {
    config.openrouter = { apiKey: body.openrouterKey as string };
  }
  if (body.model !== undefined) {
    config.model = body.model as string;
  }
  if (body.douyinUrl !== undefined) {
    if (!config.analytics) config.analytics = { douyinUrl: "", collectInterval: 60, enabled: true };
    config.analytics.douyinUrl = body.douyinUrl as string;
  }
  if (body.memorySyncEnabled !== undefined) {
    if (!config.memory) config.memory = { apiKey: "", userId: "autoviral-user", syncEnabled: false };
    config.memory.syncEnabled = body.memorySyncEnabled as boolean;
  }

  await saveConfig(config);
  return c.json(config);
});

// ---------------------------------------------------------------------------
// Work API
// ---------------------------------------------------------------------------

// GET /api/works — list works with cover image from first asset
apiRoutes.get("/api/works", async (c) => {
  try {
    const works = await listWorks();
    // Attach coverImage: prefer output image, then any image, then final video as last resort
    const enriched = await Promise.all(works.map(async (w) => {
      try {
        const assets = await listAssets(w.id);
        // 1. Output image (thumbnail/cover)
        const outputImage = assets.find((a: string) =>
          /\.(png|jpe?g|webp|gif)$/i.test(a) && a.startsWith("output/")
        );
        if (outputImage) {
          return { ...w, coverImage: `/api/works/${w.id}/assets/${outputImage.split("/").map(encodeURIComponent).join("/")}` };
        }
        // 2. Any asset image
        const firstImage = assets.find((a: string) =>
          /\.(png|jpe?g|webp|gif)$/i.test(a)
        );
        if (firstImage) {
          return { ...w, coverImage: `/api/works/${w.id}/assets/${firstImage.split("/").map(encodeURIComponent).join("/")}` };
        }
        // 3. Final video — fallback, rendered as <video> on frontend
        const finalVideo = assets.find((a: string) =>
          /\.(mp4|mov|webm)$/i.test(a) && /final/i.test(a)
        );
        if (finalVideo) {
          return { ...w, coverImage: `/api/works/${w.id}/assets/${finalVideo.split("/").map(encodeURIComponent).join("/")}`, coverIsVideo: true };
        }
      } catch {}
      return w;
    }));
    return c.json({ works: enriched });
  } catch {
    return c.json({ works: [] });
  }
});

// POST /api/works
apiRoutes.post("/api/works", async (c) => {
  try {
    const body = await c.req.json<{
      title: string;
      type: string;
      contentCategory?: string;
      videoSource?: string;
      videoSearchQuery?: string;
      platforms: string[];
      topicHint?: string;
    }>();
    if (!body.title || !body.type || !body.platforms) {
      return c.json({ error: "title, type, and platforms are required", errorCode: "create_work_validation" }, 400);
    }
    const work = await storeCreateWork({
      title: body.title,
      type: body.type as "short-video" | "image-text",
      contentCategory: body.contentCategory as any,
      videoSource: body.videoSource as any,
      videoSearchQuery: body.videoSearchQuery,
      platforms: body.platforms,
      topicHint: body.topicHint,
    });
    return c.json(work, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to create work", errorCode: "create_work_failed", detail: err instanceof Error ? err.message : undefined }, 400);
  }
});

// GET /api/works/:id
apiRoutes.get("/api/works/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const work = await getWork(id);
    if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
    return c.json(work);
  } catch {
    return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  }
});

// PUT /api/works/:id
apiRoutes.put("/api/works/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const body = await c.req.json();
    const work = await storeUpdateWork(id, body);
    if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
    return c.json(work);
  } catch {
    return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  }
});

// DELETE /api/works/:id
apiRoutes.delete("/api/works/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const deleted = await storeDeleteWork(id);
    if (!deleted) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
    return c.json({ deleted: true });
  } catch {
    return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  }
});

// GET /api/works/:id/composition — returns composition.yaml as JSON.
// For legacy works (created before Plan 2's composition format), no
// composition.yaml exists yet but the work usually has assets/clips/ + assets/music/
// + output/final*.mp4. Synthesise a starter composition from those assets so the
// user sees their content immediately on first open. Persisted only when the
// client autosaves.
apiRoutes.get("/api/works/:id/composition", async (c) => {
  const id = c.req.param("id");
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  // Return 404 only on ENOENT; corrupt YAML or read errors must not silently
  // become "no composition" — the client treats null as "fresh" and would
  // overwrite the broken file with an empty composition. (Codex review 2026-04-27)
  try {
    const raw = await readFile(
      join(dataDir, "works", id, "composition.yaml"),
      "utf-8",
    );
    const parsed = CompositionSchema.parse(yaml.load(raw));
    return c.json(synthesiseLegacyAssetsAndProvenance(parsed));
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      return c.json({ error: `Composition unreadable: ${err?.message ?? "unknown"}`, errorCode: "composition_unreadable", detail: err?.message }, 500);
    }
    // Legacy auto-build path
    const synthesised = await synthesiseLegacyComposition(id, w.type);
    if (synthesised) {
      const parsedSynth = CompositionSchema.parse(synthesised);
      return c.json(synthesiseLegacyAssetsAndProvenance(parsedSynth));
    }
    return c.json({ error: "Composition not found", errorCode: "composition_not_found" }, 404);
  }
});

async function synthesiseLegacyComposition(
  workId: string,
  workType: string,
): Promise<unknown | null> {
  if (workType !== "short-video") return null;
  const wDir = join(dataDir, "works", workId);
  const collect = async (dir: string, exts: RegExp): Promise<string[]> => {
    try {
      const items = await readdir(dir);
      return items.filter((f) => exts.test(f)).sort();
    } catch { return []; }
  };
  const finalVids = await collect(join(wDir, "output"), /\.(mp4|mov|webm)$/i);
  const clips = await collect(join(wDir, "assets", "clips"), /\.(mp4|mov|webm)$/i);
  const music = await collect(join(wDir, "assets", "music"), /\.(mp3|m4a|wav|aac)$/i);
  const hasAny = finalVids.length || clips.length || music.length;
  if (!hasAny) return null;

  // ffprobe-based duration; fall back to 5s defaults when ffprobe absent or fails
  async function probeDuration(absPath: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        absPath,
      ], { timeout: 5_000 });
      const n = parseFloat(stdout.trim());
      return Number.isFinite(n) && n > 0 ? n : 5;
    } catch { return 5; }
  }

  const videoClips: any[] = [];
  let cursor = 0;
  // The output/final*.mp4 is the user's already-curated cut (transitions, trims,
  // ordering all baked in). Sequencing assets/clips/ raw would 4×-ify duration
  // and undo the edit. So: if a final exists, it IS the timeline. The raw
  // clips/ stay reachable in the Assets sidebar for re-cutting.
  const sourceList = finalVids.length
    ? finalVids.map((f) => ({ rel: `output/${f}`, abs: join(wDir, "output", f) }))
    : clips.map((f) => ({ rel: `assets/clips/${f}`, abs: join(wDir, "assets", "clips", f) }));
  for (const { rel, abs } of sourceList) {
    const dur = await probeDuration(abs);
    videoClips.push({
      id: `vc_${cursor.toFixed(2)}`,
      kind: "video",
      src: `/api/works/${workId}/assets/${rel}`,
      in: 0,
      out: dur,
      trackOffset: cursor,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    });
    cursor += dur;
  }

  const audioClips: any[] = [];
  if (music[0]) {
    const abs = join(wDir, "assets", "music", music[0]);
    const dur = await probeDuration(abs);
    audioClips.push({
      id: `ac_bgm`,
      kind: "audio",
      src: `/api/works/${workId}/assets/assets/music/${encodeURIComponent(music[0])}`,
      in: 0,
      out: Math.min(dur, cursor || dur),
      trackOffset: 0,
      volume: 0.8,
      fadeIn: 0,
      fadeOut: 0,
    });
  }

  return {
    id: `c_${workId}`,
    workId,
    fps: 30,
    width: 1080,
    height: 1920,
    duration: Math.max(cursor, audioClips[0]?.out ?? 0),
    aspect: "9:16",
    tracks: [
      { id: "video-0", kind: "video", label: "Video", muted: false, hidden: false, clips: videoClips },
      { id: "audio-0", kind: "audio", label: "BGM", muted: false, hidden: false, clips: audioClips },
      { id: "text-0", kind: "text", label: "Subtitles", muted: false, hidden: false, clips: [] },
      { id: "overlay-0", kind: "overlay", label: "Overlay", muted: false, hidden: false, clips: [] },
    ],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * For compositions that pre-date Phase 1 (no assets/provenance arrays), walk
 * every clip's `src` and produce one AssetEntry per unique uri plus one
 * `import` provenance edge per asset. Idempotent: if assets[] is already
 * populated, the comp is returned unchanged.
 */
export function synthesiseLegacyAssetsAndProvenance(
  comp: Composition,
): Composition {
  if (comp.assets.length > 0) return comp;

  const assets: AssetEntry[] = [];
  const provenance: ProvenanceEdge[] = [];
  const seen = new Map<string, string>(); // uri → assetId

  for (const track of comp.tracks) {
    for (const clip of track.clips) {
      // Only video / audio / overlay clips reference a `src`. Text clips inline.
      if (clip.kind === "text") continue;
      const src = (clip as { src: string }).src;
      if (!src) continue;
      if (seen.has(src)) continue;

      const id = `asset-${clip.id}`;
      seen.set(src, id);

      const kind: AssetEntry["kind"] =
        clip.kind === "video" ? "video"
        : clip.kind === "audio" ? "audio"
        : "image"; // overlay → still image

      assets.push({
        id,
        uri: src,
        kind,
        name: src.split("/").pop() ?? id,
        metadata: {},
        status: "ready",
      });
      provenance.push({
        toAssetId: id,
        fromAssetId: null,
        operation: {
          type: "import",
          actor: "system",
          timestamp: comp.updatedAt,
          label: "legacy migration — pre-Phase-1 composition",
          params: {},
        },
      });
    }
  }

  return { ...comp, assets, provenance };
}

// PUT /api/works/:id/composition — persists composition as yaml
apiRoutes.put("/api/works/:id/composition", async (c) => {
  const id = c.req.param("id");
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  const body = await c.req.json();
  const parsed = CompositionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Composition schema invalid", issues: parsed.error.issues },
      400,
    );
  }
  const wDir = join(dataDir, "works", id);
  await mkdir(wDir, { recursive: true });
  await writeFile(
    join(wDir, "composition.yaml"),
    yaml.dump(parsed.data, { lineWidth: -1 }),
    "utf-8",
  );
  return c.json({ ok: true });
});

// POST /api/works/:id/composition/gc-orphans — garbage-collect AssetEntries
// whose physical files no longer exist on disk. After commit ad67b9b some
// works ended up with stale gen_* AssetEntries pointing at non-existent mp4s
// (e.g., the renderer would 404 every time). This endpoint:
//   1. Scans assets[] for video/image/audio kinds whose uri is a relative
//      work path (skips http/api/absolute uris — those are out of scope).
//   2. For each, tries both <wDir>/<uri> and <wDir>/assets/<uri> (uri shapes
//      vary across the codebase: some are "clips/foo.mp4", some are
//      "assets/clips/foo.mp4"). Marks asset status="failed" if both miss.
//   3. Removes any timeline clip referencing the orphan asset's uri.
//   4. Removes provenance edges whose toAssetId == an orphan id (orphan
//      edges break the dive view).
// Idempotent: re-running on the same composition produces the same result
// (status==="failed" is left as-is, clips already removed stay removed).
apiRoutes.post("/api/works/:id/composition/gc-orphans", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  const wDir = join(dataDir, "works", id);
  const compYamlPath = join(wDir, "composition.yaml");
  let raw: string;
  try {
    raw = await readFile(compYamlPath, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return c.json({ error: "Composition not found", errorCode: "composition_not_found" }, 404);
    return c.json({ error: `Composition unreadable: ${err?.message ?? "unknown"}`, errorCode: "composition_unreadable", detail: err?.message }, 500);
  }
  let comp: Composition;
  try {
    comp = yaml.load(raw) as Composition;
  } catch (err: any) {
    return c.json({ error: `Composition YAML invalid: ${err?.message ?? "unknown"}`, errorCode: "composition_yaml_invalid", detail: err?.message }, 500);
  }

  const { existsSync } = await import("node:fs");

  // Skip uris that are absolute, http, or backed by /api/ — only
  // work-relative paths can be GC'd here (anything else is unverifiable).
  const isLocalRelativeUri = (uri: string): boolean => {
    if (!uri) return false;
    if (uri.startsWith("http://") || uri.startsWith("https://")) return false;
    if (uri.startsWith("/api/")) return false;
    if (uri.startsWith("/")) return false;
    return true;
  };

  const fileExistsForUri = (uri: string): boolean => {
    // Try BOTH <wDir>/<uri> and <wDir>/assets/<uri> (existing AssetEntry.uri
    // shapes vary). Either match → asset is considered live.
    const direct = join(wDir, uri);
    if (existsSync(direct)) return true;
    if (!uri.startsWith("assets/")) {
      const underAssets = join(wDir, "assets", uri);
      if (existsSync(underAssets)) return true;
    }
    return false;
  };

  const orphans: string[] = [];
  let marked = 0;
  const orphanUris = new Set<string>();
  const assets = comp.assets ?? [];
  for (const a of assets) {
    if (!(a.kind === "video" || a.kind === "image" || a.kind === "audio")) continue;
    if (!isLocalRelativeUri(a.uri)) continue;
    if (fileExistsForUri(a.uri)) continue;
    orphans.push(a.id);
    orphanUris.add(a.uri);
    if (a.status !== "failed") {
      a.status = "failed";
      marked += 1;
    }
  }

  // Remove clips referencing orphan uris. We match by clip.src equality
  // against orphan asset uris — both raw work-relative and the
  // /api/works/:id/assets/<uri> URL shape are checked because the legacy
  // synthesiser writes the URL form into clip.src.
  const orphanClipSrcs = new Set<string>();
  for (const u of orphanUris) {
    orphanClipSrcs.add(u);
    orphanClipSrcs.add(`/api/works/${id}/assets/${u}`);
    if (u.startsWith("assets/")) {
      const stripped = u.slice("assets/".length);
      orphanClipSrcs.add(stripped);
      orphanClipSrcs.add(`/api/works/${id}/assets/${stripped}`);
    }
  }
  let removed = 0;
  for (const track of comp.tracks ?? []) {
    const before = track.clips.length;
    track.clips = track.clips.filter((clip) => {
      if (clip.kind === "text") return true;
      const src = (clip as { src?: string }).src;
      if (!src) return true;
      return !orphanClipSrcs.has(src);
    });
    removed += before - track.clips.length;
  }

  // Drop provenance edges whose toAssetId points at an orphan — the dive
  // view treats these as broken nodes.
  const orphanIdSet = new Set(orphans);
  if (comp.provenance) {
    comp.provenance = comp.provenance.filter((edge) => !orphanIdSet.has(edge.toAssetId));
  }

  await writeFile(compYamlPath, yaml.dump(comp, { lineWidth: -1 }), "utf-8");

  return c.json({ removed, marked, orphans });
});

// GET /api/works/:id/carousel — returns carousel.yaml as JSON
apiRoutes.get("/api/works/:id/carousel", async (c) => {
  const id = c.req.param("id");
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  try {
    const raw = await readFile(
      join(dataDir, "works", id, "carousel.yaml"),
      "utf-8",
    );
    return c.json(yaml.load(raw));
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      // No persisted carousel — try to synthesise one from output/*.png
      // (the user's already-finished carousel images). Mirrors the legacy
      // composition fallback for short-video works.
      const synthesised = await synthesiseLegacyCarousel(id, w.type);
      if (synthesised) return c.json(synthesised);
      return c.json({ error: "Carousel not found", errorCode: "carousel_not_found" }, 404);
    }
    return c.json({ error: `Carousel unreadable: ${err?.message ?? "unknown"}`, errorCode: "carousel_unreadable", detail: err?.message }, 500);
  }
});

async function synthesiseLegacyCarousel(
  workId: string,
  workType: string,
): Promise<unknown | null> {
  if (workType !== "image-text") return null;
  const wDir = join(dataDir, "works", workId);
  const collect = async (dir: string, exts: RegExp): Promise<string[]> => {
    try {
      const items = await readdir(dir);
      return items.filter((f) => exts.test(f)).sort();
    } catch { return []; }
  };
  // Prefer output/*.png (already-rendered final carousel pages),
  // fall back to assets/images/*.png if no output exists.
  const outputImgs = await collect(join(wDir, "output"), /\.(png|jpe?g|webp)$/i);
  const assetImgs = await collect(join(wDir, "assets", "images"), /\.(png|jpe?g|webp)$/i);
  const sources = outputImgs.length
    ? outputImgs.map((f) => ({ rel: `output/${f}`, name: f }))
    : assetImgs.map((f) => ({ rel: `assets/images/${f}`, name: f }));
  if (sources.length === 0) return null;

  const slides = sources.map((s, i) => ({
    id: `s_legacy_${i}`,
    bg: {
      type: "image" as const,
      value: `/api/works/${workId}/assets/${s.rel.split("/").map(encodeURIComponent).join("/")}`,
    },
    layers: [],
  }));

  return {
    id: `car_${workId}`,
    workId,
    width: 1080,
    height: 1350,
    globals: {
      headlineFont: "serif",
      palette: "mono",
      layout: "centered",
      effects: { grain: 0.03, gradient: 0.5, sharpen: 0 },
    },
    slides,
    updatedAt: new Date().toISOString(),
  };
}

// PUT /api/works/:id/carousel — persists carousel as yaml
apiRoutes.put("/api/works/:id/carousel", async (c) => {
  const id = c.req.param("id");
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  const body = await c.req.json();
  const wDir = join(dataDir, "works", id);
  await mkdir(wDir, { recursive: true });
  await writeFile(
    join(wDir, "carousel.yaml"),
    yaml.dump(body, { lineWidth: -1 }),
    "utf-8",
  );
  return c.json({ ok: true });
});

// POST /api/works/:id/render — enqueues a render job; the worker drains it.
// Phase 7.B — contract changed: now returns { jobId } (was { ok, output }).
// Body: { type?: "full"|"proxy", presetId?: string, burnSubtitles?: boolean,
//         loudnessTargetLufs?: number }
apiRoutes.post("/api/works/:id/render", async (c) => {
  const id = c.req.param("id");
  if (!renderQueue) {
    return c.json({ error: "RenderQueue not initialized", errorCode: "render_queue_unavailable" }, 503);
  }
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  // Cheap fail-fast: composition.yaml must exist on disk before we enqueue.
  // The worker re-loads + validates it via loadComposition; this just gives
  // the user a synchronous 400 instead of a queued-then-failed job.
  try {
    await readFile(join(dataDir, "works", id, "composition.yaml"), "utf-8");
  } catch {
    return c.json({ error: "Composition missing — save first", errorCode: "composition_missing" }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const type: "full" | "proxy" = body.type === "proxy" ? "proxy" : "full";
  const job = renderQueue.enqueue({
    workId: id,
    type,
    presetId: typeof body.presetId === "string" ? body.presetId : undefined,
    burnSubtitles: !!body.burnSubtitles,
    loudnessTargetLufs:
      typeof body.loudnessTargetLufs === "number"
        ? body.loudnessTargetLufs
        : undefined,
  });
  return c.json({ jobId: job.id });
});

// GET /api/render/jobs/:id — Phase 7.B
apiRoutes.get("/api/render/jobs/:id", (c) => {
  if (!renderQueue) {
    return c.json({ error: "RenderQueue not initialized", errorCode: "render_queue_unavailable" }, 503);
  }
  const job = renderQueue.get(c.req.param("id"));
  if (!job) return c.json({ error: "Job not found", errorCode: "render_job_not_found" }, 404);
  return c.json(job);
});

// DELETE /api/render/jobs/:id — Phase 7.B
// Cancels a queued or running job. D9: cancelling queued is synchronous;
// running jobs receive an AbortSignal which the pipeline honours.
apiRoutes.delete("/api/render/jobs/:id", (c) => {
  if (!renderQueue) {
    return c.json({ error: "RenderQueue not initialized", errorCode: "render_queue_unavailable" }, 503);
  }
  const id = c.req.param("id");
  renderQueue.cancel(id);
  const job = renderQueue.get(id);
  if (!job) return c.json({ error: "Job not found", errorCode: "render_job_not_found" }, 404);
  return c.json(job);
});

// POST /api/render/reveal — R43. Reveal a render output in the OS file
// browser (Finder on macOS, Explorer on Windows, xdg-open on Linux).
// Body: { workId, filename }. Returns { ok: true } on success or 501 if
// the platform isn't supported. Constrained to filenames inside
// <workDir>/output/ so an injection-safe filename can't escape.
apiRoutes.post("/api/render/reveal", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const workId = String(body.workId ?? "");
  const filename = String(body.filename ?? "");
  if (!SAFE_ID.test(workId)) {
    return c.json({ error: "Invalid workId", errorCode: "invalid_work_id" }, 400);
  }
  // Hard-fail any path-traversal attempts; resolveAssetPath also enforces
  // this via UnsafePathError, but earlier rejection produces a clearer
  // 400 and avoids touching the FS.
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.startsWith(".")) {
    return c.json({ error: "Invalid filename", errorCode: "invalid_filename" }, 400);
  }
  let absolutePath: string;
  try {
    absolutePath = resolveAssetPath(workId, "output", filename);
  } catch (err) {
    if (err instanceof UnsafePathError) {
      return c.json({ error: err.message, errorCode: "invalid_path" }, 400);
    }
    throw err;
  }
  // Confirm the file actually exists before invoking the OS — otherwise
  // we'd open Finder on a missing path which is just confusing.
  try {
    const { stat } = await import("node:fs/promises");
    await stat(absolutePath);
  } catch {
    return c.json({ error: "Output file not found", errorCode: "output_not_found" }, 404);
  }
  const platform = process.platform;
  // execFile with separate args (NOT `exec` with shell=true) so the file
  // path can't be parsed as shell metacharacters even if it slipped past
  // the safety checks above.
  try {
    if (platform === "darwin") {
      // -R reveals the file in Finder (selects it inside its folder)
      // rather than opening the file itself in QuickTime.
      await new Promise<void>((res, rej) => {
        execFile("open", ["-R", absolutePath], (err) =>
          err ? rej(err) : res(),
        );
      });
      return c.json({ ok: true, platform });
    }
    if (platform === "win32") {
      await new Promise<void>((res, rej) => {
        execFile("explorer", [`/select,${absolutePath}`], (err) =>
          err ? rej(err) : res(),
        );
      });
      return c.json({ ok: true, platform });
    }
    if (platform === "linux") {
      // xdg-open opens the *containing folder*; selecting the file
      // depends on the file manager (nautilus supports --select but
      // dolphin uses different flags). Folder-only is the safe baseline.
      const { dirname } = await import("node:path");
      await new Promise<void>((res, rej) => {
        execFile("xdg-open", [dirname(absolutePath)], (err) =>
          err ? rej(err) : res(),
        );
      });
      return c.json({ ok: true, platform });
    }
    return c.json(
      { error: `reveal unsupported on ${platform}`, errorCode: "reveal_unsupported_platform" },
      501,
    );
  } catch (err: any) {
    return c.json(
      { error: `reveal failed: ${err?.message ?? String(err)}`, errorCode: "reveal_failed" },
      500,
    );
  }
});

// POST /api/transitions/light-leak — R46 #5. Cinematic cross-fade
// transition between two clips with a procedural orange light-streak
// sweep. Pure ffmpeg (no GLSL); agent invokes when assembly module
// wants a film-burn-style cut between scenes.
//
// Body: {
//   workId, clipARelative, clipBRelative, outputFilename,
//   clipADuration: seconds, transitionDuration?: seconds (default 0.8)
// }
// All paths are work-relative (e.g. "assets/clips/intro.mp4"); resolved
// safely via resolveAssetPath. Output writes to <workDir>/output/<file>.
apiRoutes.post("/api/transitions/light-leak", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const workId = String(body.workId ?? "");
  const clipARel = String(body.clipARelative ?? "");
  const clipBRel = String(body.clipBRelative ?? "");
  const outputFilename = String(body.outputFilename ?? "");
  const clipADuration = Number(body.clipADuration);
  const transitionDuration = Number(body.transitionDuration ?? 0.8);

  if (!SAFE_ID.test(workId)) {
    return c.json({ error: "Invalid workId", errorCode: "invalid_work_id" }, 400);
  }
  if (!clipARel || !clipBRel || !outputFilename) {
    return c.json(
      { error: "Missing clipARelative/clipBRelative/outputFilename", errorCode: "invalid_params" },
      400,
    );
  }
  if (!Number.isFinite(clipADuration) || clipADuration <= 0) {
    return c.json(
      { error: "clipADuration must be a positive number (seconds)", errorCode: "invalid_params" },
      400,
    );
  }
  if (transitionDuration <= 0 || transitionDuration >= clipADuration) {
    return c.json(
      {
        error: "transitionDuration must be > 0 and < clipADuration",
        errorCode: "invalid_params",
      },
      400,
    );
  }
  // Path-traversal defence — same pattern as reveal endpoint.
  if (
    outputFilename.includes("/") ||
    outputFilename.includes("\\") ||
    outputFilename.startsWith(".")
  ) {
    return c.json(
      { error: "Invalid outputFilename", errorCode: "invalid_filename" },
      400,
    );
  }

  let clipA: string;
  let clipB: string;
  let outPath: string;
  try {
    const resolvePath = (rel: string) => {
      const cleaned = rel.replace(/^\/+/, "");
      const root = cleaned.startsWith("output/") ? "output" : "assets";
      const rest = cleaned.startsWith("output/")
        ? cleaned.slice(7)
        : cleaned.startsWith("assets/")
          ? cleaned.slice(7)
          : cleaned;
      return resolveAssetPath(workId, root, rest);
    };
    clipA = resolvePath(clipARel);
    clipB = resolvePath(clipBRel);
    outPath = resolveAssetPath(workId, "output", outputFilename);
  } catch (err) {
    if (err instanceof UnsafePathError) {
      return c.json({ error: err.message, errorCode: "invalid_path" }, 400);
    }
    throw err;
  }

  // Probe clipA dimensions so we can size the overlay correctly. The
  // transitions module caches the overlay PNG per (width, height), so
  // mismatched sizes between calls are fine.
  const { applyLightLeakTransition } = await import("./render/transitions.js");
  const { execFile } = await import("node:child_process");
  const { promisify: p } = await import("node:util");
  const ef = p(execFile);
  let width = 1080;
  let height = 1920;
  let fps = 30;
  try {
    const { stdout } = await ef("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,r_frame_rate",
      "-of", "default=noprint_wrappers=1",
      clipA,
    ]);
    for (const line of stdout.split("\n")) {
      const [k, v] = line.split("=");
      if (k === "width") width = parseInt(v ?? "1080", 10) || 1080;
      else if (k === "height") height = parseInt(v ?? "1920", 10) || 1920;
      else if (k === "r_frame_rate") {
        // r_frame_rate is "num/den" e.g. "30/1"; eval it.
        const [n, d] = (v ?? "30/1").split("/").map(Number);
        if (n && d) fps = Math.round(n / d);
      }
    }
  } catch {
    // ffprobe failure means clipA is unreadable; let applyLightLeak fail
    // with the actual ffmpeg error rather than guessing.
  }

  try {
    const result = await applyLightLeakTransition({
      clipA,
      clipB,
      outputPath: outPath,
      clipADuration,
      transitionDuration,
      width,
      height,
      fps,
    });
    return c.json({
      ok: true,
      outputPath: result,
      previewUrl: `/api/works/${workId}/assets/output/${encodeURIComponent(outputFilename)}`,
    });
  } catch (err: any) {
    return c.json(
      { error: err?.message ?? String(err), errorCode: "transition_failed" },
      500,
    );
  }
});

// GET /api/works/:id/assets
apiRoutes.get("/api/works/:id/assets", async (c) => {
  const id = c.req.param("id");
  try {
    const assets = await listAssets(id);
    return c.json({ assets });
  } catch {
    return c.json({ assets: [] });
  }
});

// ── Phase 8.1.B: CLIP semantic search ────────────────────────────────────────
// Registered BEFORE the wildcard /api/works/:id/assets/* so this exact route
// wins precedence — Hono matches in registration order for static segments.

// GET /api/works/:id/assets/search?q=<text>&topK=<n>  (CLIP semantic search)
apiRoutes.get("/api/works/:id/assets/search", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);
  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ error: "q required" }, 400);
  const rawK = parseInt(c.req.query("topK") ?? "20", 10);
  const topK = Number.isFinite(rawK)
    ? Math.max(1, Math.min(100, rawK))
    : 20;
  try {
    const { searchClipIndex } = await import("./clip-index.js");
    return c.json(await searchClipIndex(id, q, topK));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /api/clip-index/build — build/refresh the per-work CLIP index
apiRoutes.post("/api/clip-index/build", async (c) => {
  let body: { workId?: string };
  try {
    body = await c.req.json<{ workId: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const workId = body?.workId;
  if (!workId || !SAFE_ID.test(workId)) {
    return c.json({ error: "Invalid workId" }, 400);
  }
  try {
    const { buildClipIndex } = await import("./clip-index.js");
    return c.json(await buildClipIndex(workId));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/clip-index/status?workId=<id>
apiRoutes.get("/api/clip-index/status", async (c) => {
  const workId = c.req.query("workId");
  if (!workId || !SAFE_ID.test(workId)) {
    return c.json({ error: "Invalid workId" }, 400);
  }
  try {
    const { getClipIndexStatus } = await import("./clip-index.js");
    return c.json(await getClipIndexStatus(workId));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/works/:id/assets/* — serve asset files (supports nested paths like images/scene-01.png or output/final.mp4)
apiRoutes.get("/api/works/:id/assets/*", async (c) => {
  const id = c.req.param("id");
  // Extract the nested path after /assets/
  const url = new URL(c.req.url);
  const prefix = `/api/works/${id}/assets/`;
  const nestedPath = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!nestedPath) return c.json({ error: "Asset path required" }, 400);

  try {
    // Map URL → physical asset root. Only assets/ and output/ are reachable —
    // work.yaml / chat.json / eval-*.json are NEVER served. (Codex review 2026-04-27)
    //
    // URL forms:
    //   /assets/output/<path>  → workDir/output/<path>
    //   /assets/assets/<path>  → workDir/assets/<path>
    //   /assets/<path>         → workDir/assets/<path>  (legacy, default to assets/)
    let root: "assets" | "output";
    let rest: string;
    if (nestedPath.startsWith("output/")) {
      root = "output";
      rest = nestedPath.slice("output/".length);
    } else if (nestedPath.startsWith("assets/")) {
      root = "assets";
      rest = nestedPath.slice("assets/".length);
    } else {
      root = "assets";
      rest = nestedPath;
    }
    if (!rest) return c.json({ error: "Asset path required" }, 400);
    const filePath = resolveAssetPath(id, root, rest);
    const { stat } = await import("node:fs/promises");
    const fileStat = await stat(filePath);
    const fileSize = fileStat.size;
    const mimeType = getMimeType(filePath);
    const rangeHeader = c.req.header("range");

    // Support HTTP Range requests (required for browser video/audio playback)
    if (rangeHeader && (mimeType.startsWith("video/") || mimeType.startsWith("audio/"))) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        const fullContent = await readFile(filePath);
        const slice = fullContent.subarray(start, end + 1);
        return new Response(slice, {
          status: 206,
          headers: {
            "Content-Type": mimeType,
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Content-Length": String(chunkSize),
            "Accept-Ranges": "bytes",
          },
        });
      }
    }

    const content = await readFile(filePath);
    return new Response(content, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
      },
    });
  } catch {
    return c.json({ error: "Asset not found", errorCode: "asset_not_found" }, 404);
  }
});

// POST /api/works/:id/assets/upload — upload file to work assets
apiRoutes.post("/api/works/:id/assets/upload", async (c) => {
  const workId = c.req.param("id");
  if (!SAFE_ID.test(workId)) return c.json({ error: "Invalid workId" }, 400);

  const work = await getWork(workId);
  if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);

  const body = await c.req.parseBody();
  const file = body.file;
  const subdir = (body.subdir as string) ?? "images";

  if (!(file instanceof File)) {
    return c.json({ error: "No file provided" }, 400);
  }

  // Sanitize basename to prevent path traversal (Codex review 2026-04-27)
  const safeBasename = file.name.replace(/[/\\]/g, "_").replace(/^\.+/, "");
  if (!safeBasename) return c.json({ error: "Invalid filename" }, 400);

  let filePath: string;
  try {
    filePath = resolveAssetSubpath(workId, "assets", subdir, safeBasename);
  } catch (err) {
    if (err instanceof UnsafePathError) return c.json({ error: err.message }, 400);
    throw err;
  }

  // Ensure parent directory exists
  const { dirname } = await import("node:path");
  await mkdir(dirname(filePath), { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  // Clean URL — GET defaults to workDir/assets/ when no explicit root prefix
  return c.json({
    success: true,
    path: `assets/${subdir}/${safeBasename}`,
    url: `/api/works/${workId}/assets/${subdir}/${encodeURIComponent(safeBasename)}`,
  });
});

// GET /api/analytics — aggregate metrics from all works
apiRoutes.get("/api/analytics", async (c) => {
  try {
    const summaries = await listWorks();
    const totalWorks = summaries.length;
    const totalViews = 0;
    const totalLikes = 0;
    const totalComments = 0;

    return c.json({ totalWorks, totalViews, totalLikes, totalComments });
  } catch {
    return c.json({ totalWorks: 0, totalViews: 0, totalLikes: 0, totalComments: 0 });
  }
});

// GET /api/analytics/creator — latest creator data + trend delta
apiRoutes.get("/api/analytics/creator", async (c) => {
  const latest = await getLatestCreatorData()
  if (!latest) return c.json({ configured: false, data: null })
  const history = await getCreatorHistory(7)
  const yesterday = history.find(h => h.date !== new Date().toISOString().slice(0, 10))
  let delta: Record<string, number> | null = null
  if (yesterday?.data?.account && latest.account) {
    delta = {
      followers: latest.account.follower_count - yesterday.data.account.follower_count,
      favorited: latest.account.total_favorited - yesterday.data.account.total_favorited,
    }
  }
  return c.json({ configured: true, data: latest, delta })
})

// GET /api/analytics/creator/history — daily snapshots for charts
apiRoutes.get("/api/analytics/creator/history", async (c) => {
  const history = await getCreatorHistory(30)
  return c.json({ history })
})

// ---------------------------------------------------------------------------
// Generate API (Provider-based image/video generation)
// ---------------------------------------------------------------------------

// POST /api/generate/image
apiRoutes.post("/api/generate/image", async (c) => {
  const body = await c.req.json();
  const { workId, prompt, width, height, filename, provider: providerName, referenceImage,
    aspectRatio, imageSize, seed, temperature, model } = body;
  if (!workId || !prompt || !filename) {
    return c.json({ success: false, error: "Missing required fields", code: "INVALID_PARAMS" }, 400);
  }
  // Sanitize workId + filename — provider does raw join() that would otherwise
  // accept ../ traversal. (Codex round 2: provider files still raw)
  if (!SAFE_ID.test(workId)) {
    return c.json({ success: false, error: "Invalid workId", code: "INVALID_PARAMS" }, 400);
  }
  const safeFilename = String(filename).replace(/[/\\]/g, "_").replace(/^\.+/, "");
  if (!safeFilename) {
    return c.json({ success: false, error: "Invalid filename", code: "INVALID_PARAMS" }, 400);
  }
  const provider = providerName ? getProvider(providerName) : getDefaultProvider("image");
  if (!provider) {
    return c.json({ success: false, error: "No image provider available", code: "INVALID_PARAMS" }, 400);
  }
  try {
    const result = await provider.generateImage({
      prompt, width, height, workId, filename: safeFilename, referenceImage,
      aspectRatio, imageSize, seed, temperature, model,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/generate/video
apiRoutes.post("/api/generate/video", async (c) => {
  const body = await c.req.json();
  const { workId, prompt, firstFrame, lastFrame, resolution, filename, provider: providerName } = body;
  if (!workId || !prompt || !filename) {
    return c.json({ success: false, error: "Missing required fields", code: "INVALID_PARAMS" }, 400);
  }
  if (!SAFE_ID.test(workId)) {
    return c.json({ success: false, error: "Invalid workId", code: "INVALID_PARAMS" }, 400);
  }
  const safeFilename = String(filename).replace(/[/\\]/g, "_").replace(/^\.+/, "");
  if (!safeFilename) {
    return c.json({ success: false, error: "Invalid filename", code: "INVALID_PARAMS" }, 400);
  }
  // firstFrame/lastFrame are also user-controlled paths — sanitize via assets/-rooted resolve
  const safeFirstFrame = firstFrame
    ? (() => {
        try {
          const cleaned = String(firstFrame).replace(/^\/+/, "");
          const root = cleaned.startsWith("output/") ? "output" : "assets";
          const rest = cleaned.startsWith("output/") ? cleaned.slice(7)
                     : cleaned.startsWith("assets/") ? cleaned.slice(7) : cleaned;
          return resolveAssetPath(workId, root, rest);
        } catch { return undefined; }
      })()
    : undefined;
  if (firstFrame && !safeFirstFrame) {
    return c.json({ success: false, error: "Invalid firstFrame path", code: "INVALID_PATH" }, 400);
  }
  const provider = providerName ? getProvider(providerName) : getDefaultProvider("video");
  if (!provider) {
    return c.json({ success: false, error: "No video provider available", code: "INVALID_PARAMS" }, 400);
  }
  try {
    const result = await provider.generateVideo({
      prompt, firstFrame: safeFirstFrame ?? firstFrame, lastFrame, resolution, workId, filename: safeFilename,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// SAFE_ID imported from ./safe-paths.js — single source of truth

// POST /api/generate/image/batch — generate multiple candidate frames for a shot
apiRoutes.post("/api/generate/image/batch", async (c) => {
  const body = await c.req.json();
  const {
    workId, prompt, shotId,
    count = 4,
    width, height, aspectRatio,
    provider: providerName,
  } = body;
  if (!workId || !prompt || !shotId) {
    return c.json({ success: false, error: "Missing required fields (workId, prompt, shotId)", code: "INVALID_PARAMS" }, 400);
  }
  if (!SAFE_ID.test(workId) || !SAFE_ID.test(shotId)) {
    return c.json({ success: false, error: "Invalid workId or shotId", code: "INVALID_PARAMS" }, 400);
  }
  const n = Math.min(Math.max(1, Number(count) || 4), 8);
  const provider = providerName ? getProvider(providerName) : getDefaultProvider("image");
  if (!provider) {
    return c.json({ success: false, error: "No image provider available", code: "INVALID_PARAMS" }, 400);
  }

  try {
    const candidatesDir = join(dataDir, "works", workId, "assets", "frames", "candidates", shotId);
    await mkdir(candidatesDir, { recursive: true });

    // Generate `n` random seeds and fire all requests concurrently
    const seeds = Array.from({ length: n }, () => Math.floor(Math.random() * 2_147_483_647));
    const results = await Promise.allSettled(
      seeds.map((seed) =>
        provider.generateImage({
          prompt, width, height, aspectRatio, workId, seed,
          filename: `frames/candidates/${shotId}/seed-${seed}.png`,
        }),
      ),
    );

    const candidates: { path: string; seed: number; previewUrl: string }[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled" && r.value.success) {
        candidates.push({
          path: r.value.assetPath ?? `frames/candidates/${shotId}/seed-${seeds[i]}.png`,
          seed: seeds[i],
          previewUrl: r.value.previewUrl ?? `/api/works/${workId}/assets/frames/candidates/${shotId}/seed-${seeds[i]}.png`,
        });
      }
      // silently skip failed candidates
    }

    if (candidates.length === 0) {
      return c.json({ success: false, error: "All candidate generations failed", code: "API_ERROR" }, 500);
    }

    return c.json({ success: true, shotId, candidates });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/frames/select — pick a winning frame from candidates
apiRoutes.post("/api/frames/select", async (c) => {
  const body = await c.req.json();
  const { workId, shotId, selectedSeed } = body;
  if (!workId || !shotId || selectedSeed == null) {
    return c.json({ success: false, error: "Missing required fields (workId, shotId, selectedSeed)", code: "INVALID_PARAMS" }, 400);
  }
  if (!SAFE_ID.test(workId) || !SAFE_ID.test(shotId)) {
    return c.json({ success: false, error: "Invalid workId or shotId", code: "INVALID_PARAMS" }, 400);
  }

  const candidatesDir = join(dataDir, "works", workId, "assets", "frames", "candidates", shotId);
  const framesDir = join(dataDir, "works", workId, "assets", "frames");
  let files: string[];
  try {
    files = await readdir(candidatesDir);
  } catch {
    return c.json({ success: false, error: "Candidates directory not found", code: "INVALID_PARAMS" }, 404);
  }

  try {
    // Strip any previous _rejected suffixes to support re-selection
    for (const f of files) {
      if (f.includes("_rejected")) {
        const restored = f.replaceAll("_rejected", "");
        await rename(join(candidatesDir, f), join(candidatesDir, restored));
      }
    }

    // Re-read after rename
    files = await readdir(candidatesDir);

    const selectedFile = files.find((f) => f.includes(`seed-${selectedSeed}`));
    if (!selectedFile) {
      return c.json({ success: false, error: `No candidate found for seed ${selectedSeed}`, code: "INVALID_PARAMS" }, 404);
    }

    // Copy selected frame to the final location
    const framePath = `frames/frame-${shotId}.png`;
    await copyFile(join(candidatesDir, selectedFile), join(framesDir, `frame-${shotId}.png`));

    // Rename non-selected candidates with _rejected suffix
    for (const f of files) {
      if (f === selectedFile) continue;
      const ext = extname(f);
      const base = f.slice(0, -ext.length);
      await rename(join(candidatesDir, f), join(candidatesDir, `${base}_rejected${ext}`));
    }

    return c.json({ success: true, framePath });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/audio/analyze — detect audio properties of a clip
apiRoutes.post("/api/audio/analyze", async (c) => {
  try {
    const body = await c.req.json();
    const { workId, assetPath } = body;
    if (!workId || !assetPath) {
      return c.json({ success: false, error: "Missing required fields (workId, assetPath)", code: "INVALID_PARAMS" }, 400);
    }
    if (!SAFE_ID.test(workId)) {
      return c.json({ success: false, error: "Invalid workId", code: "INVALID_PARAMS" }, 400);
    }
    // Resolve under workDir/assets/ or workDir/output/ — never raw workDir.
    // Path traversal hardening (Codex review 2026-04-27).
    let fullPath: string;
    try {
      const cleaned = String(assetPath).replace(/^\/+/, "");
      if (cleaned.startsWith("output/")) {
        fullPath = resolveAssetPath(workId, "output", cleaned.slice("output/".length));
      } else if (cleaned.startsWith("assets/")) {
        fullPath = resolveAssetPath(workId, "assets", cleaned.slice("assets/".length));
      } else {
        fullPath = resolveAssetPath(workId, "assets", cleaned);
      }
    } catch (err) {
      if (err instanceof UnsafePathError) {
        return c.json({ success: false, error: err.message, code: "INVALID_PATH" }, 400);
      }
      throw err;
    }
    const analysis = await analyzeAudio(fullPath);
    return c.json({ success: true, ...analysis });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/audio/mix — multi-track audio mixing with ducking
apiRoutes.post("/api/audio/mix", async (c) => {
  try {
    const body = await c.req.json();
    const { workId, videoPath, tracks, outputFilename } = body;

    // Validate required fields
    if (!workId || !videoPath || !tracks || !outputFilename) {
      return c.json(
        { success: false, error: "Missing required fields (workId, videoPath, tracks, outputFilename)", code: "INVALID_PARAMS" },
        400,
      );
    }
    if (!SAFE_ID.test(workId)) {
      return c.json({ success: false, error: "Invalid workId", code: "INVALID_PARAMS" }, 400);
    }
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return c.json(
        { success: false, error: "tracks must be a non-empty array", code: "INVALID_PARAMS" },
        400,
      );
    }

    // Path traversal hardening (Codex review 2026-04-27): resolve every user-supplied
    // path through resolveAssetPath. videoPath/track.source default to assets/ root;
    // outputFilename is restricted to a basename under output/.
    function resolveUnderWork(p: string): string {
      const cleaned = String(p).replace(/^\/+/, "");
      if (cleaned.startsWith("output/")) return resolveAssetPath(workId, "output", cleaned.slice(7));
      if (cleaned.startsWith("assets/")) return resolveAssetPath(workId, "assets", cleaned.slice(7));
      return resolveAssetPath(workId, "assets", cleaned);
    }

    let fullVideoPath: string;
    let fullOutputPath: string;
    let resolvedTracks: any[];
    let safeOutName: string;
    try {
      fullVideoPath = resolveUnderWork(videoPath);
      // outputFilename is a basename only — prevent traversal even if user passes "../foo"
      safeOutName = String(outputFilename).replace(/[/\\]/g, "_").replace(/^\.+/, "");
      if (!safeOutName) return c.json({ success: false, error: "Invalid outputFilename", code: "INVALID_PARAMS" }, 400);
      fullOutputPath = resolveAssetPath(workId, "output", safeOutName);
      resolvedTracks = tracks.map((t: any) => ({ ...t, source: resolveUnderWork(t.source) }));
    } catch (err) {
      if (err instanceof UnsafePathError) {
        return c.json({ success: false, error: err.message, code: "INVALID_PATH" }, 400);
      }
      throw err;
    }
    const { dirname: _dirname } = await import("node:path");
    await mkdir(_dirname(fullOutputPath), { recursive: true });

    await mixAudioTracks({
      videoPath: fullVideoPath,
      tracks: resolvedTracks,
      outputPath: fullOutputPath,
    });

    // Response uses the SANITIZED basename. Earlier version returned raw
    // outputFilename, which would break asset references AND leak the unsafe
    // input back to the client. (Codex round 2 finding #3)
    return c.json({
      success: true,
      assetPath: `output/${safeOutName}`,
      previewUrl: `/api/works/${workId}/assets/output/${encodeURIComponent(safeOutName)}`,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/audio/beats — beat detection via skills/.../detect_beats.py
// Studio's useBeatSnap hook calls this to populate the snap-target list.
// Returns: { success, beats: number[], bpm: number } when librosa is installed,
// 503 with a friendly install hint otherwise.
apiRoutes.post("/api/audio/beats", async (c) => {
  try {
    const body = await c.req.json<{ workId?: string; assetPath?: string }>();
    const { workId, assetPath } = body;
    if (!workId || !assetPath) return c.json({ success: false, error: "Missing workId/assetPath" }, 400);
    if (!SAFE_ID.test(workId)) return c.json({ success: false, error: "Invalid workId" }, 400);

    let fullPath: string;
    try {
      const cleaned = String(assetPath).replace(/^\/+/, "");
      const root = cleaned.startsWith("output/") ? "output" : "assets";
      const rest = cleaned.startsWith("output/") ? cleaned.slice(7)
                 : cleaned.startsWith("assets/") ? cleaned.slice(7)
                 : cleaned;
      fullPath = resolveAssetPath(workId, root, rest);
    } catch (err) {
      if (err instanceof UnsafePathError) return c.json({ success: false, error: err.message }, 400);
      throw err;
    }

    const script = join(repoRoot, "skills/autoviral/modules/assembly/scripts/beat-sync/detect_beats.py");
    // detect_beats.py emits structured JSON ({"error": "..."}) on stdout for both
    // success and known failures (incl. ImportError on librosa), exiting 1 on
    // failure. Parse stdout regardless of exit code, then look at stderr only as
    // a fallback for crashes that didn't reach the script's own error handler.
    // (Codex round 2 finding #2)
    let stdout = "";
    let stderr = "";
    try {
      const result = await execFileAsync("python3", [script, fullPath], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err: any) {
      stdout = err?.stdout ?? "";
      stderr = err?.stderr ?? err?.message ?? "";
    }
    let parsed: any = null;
    try { parsed = JSON.parse(stdout); } catch { /* not JSON */ }
    if (parsed?.error) {
      const errMsg = String(parsed.error);
      if (/librosa/i.test(errMsg)) {
        return c.json({
          success: false,
          error: "librosa not installed. Run `pip install librosa numpy` to enable beat detection.",
          code: "PYTHON_DEP_MISSING",
        }, 503);
      }
      return c.json({ success: false, error: errMsg, code: "API_ERROR" }, 500);
    }
    if (parsed && Array.isArray(parsed.beat_times)) {
      return c.json({
        success: true,
        beats: parsed.beat_times,
        strongBeats: Array.isArray(parsed.strong_beats) ? parsed.strong_beats : [],
        bpm: typeof parsed.bpm === "number" ? parsed.bpm : null,
      });
    }
    // Fallback: examine stderr for raw Python tracebacks
    if (/ModuleNotFoundError.*librosa|No module named.*librosa/.test(stderr)) {
      return c.json({
        success: false,
        error: "librosa not installed. Run `pip install librosa numpy` to enable beat detection.",
        code: "PYTHON_DEP_MISSING",
      }, 503);
    }
    return c.json({ success: false, error: stderr || "Beat detection produced no output", code: "API_ERROR" }, 500);
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/audio/captions — ASR caption generation via caption_generate.py
// Studio's caption import button calls this to populate the text track with
// time-coded captions. Returns:
//   { success, captions: [{start, end, text}, ...] } when stable-ts works
//   503 with install hint when stable-ts/whisper not available
apiRoutes.post("/api/audio/captions", async (c) => {
  try {
    const body = await c.req.json<{ workId?: string; assetPath?: string; language?: string }>();
    const { workId, assetPath, language } = body;
    if (!workId || !assetPath) return c.json({ success: false, error: "Missing workId/assetPath" }, 400);
    if (!SAFE_ID.test(workId)) return c.json({ success: false, error: "Invalid workId" }, 400);

    let fullPath: string;
    try {
      const cleaned = String(assetPath).replace(/^\/+/, "");
      const root = cleaned.startsWith("output/") ? "output" : "assets";
      const rest = cleaned.startsWith("output/") ? cleaned.slice(7)
                 : cleaned.startsWith("assets/") ? cleaned.slice(7)
                 : cleaned;
      fullPath = resolveAssetPath(workId, root, rest);
    } catch (err) {
      if (err instanceof UnsafePathError) return c.json({ success: false, error: err.message }, 400);
      throw err;
    }

    // Use caption_generate.py in --transcribe-only mode to emit JSON segments.
    // The script's existing CLI emits ASS by default; use the helper output via
    // a sidecar JSON path. For now, shell out to a small inline python that
    // calls stable_whisper.transcribe and dumps segments.
    const py = `
import json, sys
try:
    import stable_whisper
except Exception as e:
    print(json.dumps({"error": "stable-whisper not installed: " + str(e)}), file=sys.stdout)
    sys.exit(0)
model = stable_whisper.load_model("base")
result = model.transcribe(${JSON.stringify(fullPath)}${language ? `, language=${JSON.stringify(language)}` : ""})
segs = []
for s in result.segments:
    segs.append({"start": float(s.start), "end": float(s.end), "text": s.text.strip()})
print(json.dumps({"segments": segs}))
`;
    try {
      const { stdout } = await execFileAsync("python3", ["-c", py], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
      const parsed = JSON.parse(stdout);
      if (parsed.error) {
        return c.json({
          success: false,
          // R45 — package name on PyPI is `stable-ts` (the import alias is
          // `stable_whisper` for legacy reasons). The original `pip install
          // stable-whisper` hint is wrong: that package doesn't exist on
          // PyPI and pip 404s. Burned ~5 minutes 2026-05-09 chasing this.
          error: `${parsed.error}. Run \`pip install stable-ts\` to enable ASR (the import is named stable_whisper but the PyPI package is stable-ts).`,
          code: "PYTHON_DEP_MISSING",
        }, 503);
      }
      const captions = (parsed.segments ?? []).map((s: any) => ({
        start: Number(s.start),
        end: Number(s.end),
        text: String(s.text ?? ""),
      }));
      return c.json({ success: true, captions });
    } catch (err: any) {
      return c.json({ success: false, error: err?.stderr ?? err?.message ?? "ASR failed", code: "API_ERROR" }, 500);
    }
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/audio/tts — TTS generation via Phase 3.E provider registry
apiRoutes.post("/api/audio/tts", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || !body.text || !body.voice || !body.output_path) {
    return c.json(
      { error: "TTS request missing required fields", required: ["text", "voice", "output_path"] },
      400,
    );
  }
  const provider = pickProvider({
    language: typeof body.language === "string" ? body.language : undefined,
  });
  try {
    const r = await provider.generate({
      text: String(body.text),
      voice: String(body.voice),
      style: typeof body.style === "string" ? body.style : undefined,
      outputPath: String(body.output_path),
    });
    return c.json({
      ok: true,
      outputPath: r.outputPath,
      duration: r.duration,
      sampleRate: r.sampleRate,
      channels: r.channels,
    });
  } catch (e: any) {
    return c.json({ error: "TTS provider error", message: e?.message ?? String(e), errorCode: "tts_provider_error", detail: e?.message ?? String(e) }, 500);
  }
});

// GET /api/generate/providers
apiRoutes.get("/api/generate/providers", (c) => c.json(listProviders()));

// ---------------------------------------------------------------------------
// Shared Assets
// ---------------------------------------------------------------------------

apiRoutes.get("/api/shared-assets", async (c) => {
  const assets = await listSharedAssetsWithMeta();
  return c.json(assets);
});

apiRoutes.get("/api/shared-assets/:category/:file", async (c) => {
  const category = c.req.param("category");
  const file = c.req.param("file");
  try {
    validateCategory(category);
    const filePath = getSharedAssetPath(category, file);
    const data = await readFile(filePath);
    const mime = getMimeType(filePath);
    const isMedia = mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/");
    return new Response(data, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": isMedia ? "inline" : `attachment; filename="${encodeURIComponent(sanitizeFilename(file))}"`,
      },
    });
  } catch (e: any) {
    if (e.code === "ENOENT") return c.json({ error: "File not found" }, 404);
    if (e.message?.includes("Invalid")) return c.json({ error: e.message }, 400);
    return c.json({ error: "Failed to read file" }, 500);
  }
});

apiRoutes.post("/api/shared-assets/move", async (c) => {
  try {
    const { from, to, file } = await c.req.json<{ from: string; to: string; file: string }>();
    if (!from || !to || !file) return c.json({ error: "from, to, and file are required" }, 400);
    await moveSharedAsset(from, to, file);
    return c.json({ moved: true, from, to, file });
  } catch (e: any) {
    if (e.code === "ENOENT") return c.json({ error: "File not found" }, 404);
    if (e.message?.includes("Invalid")) return c.json({ error: e.message }, 400);
    if (e.message?.includes("already exists")) return c.json({ error: e.message }, 409);
    return c.json({ error: e.message ?? "Move failed" }, 500);
  }
});

apiRoutes.post("/api/shared-assets/:category", async (c) => {
  const category = c.req.param("category");
  try {
    validateCategory(category);
  } catch {
    return c.json({ error: `Invalid category: ${category}` }, 400);
  }
  try {
    const body = await c.req.parseBody({ all: true });
    const files = Array.isArray(body["file"]) ? body["file"] : body["file"] ? [body["file"]] : [];
    const uploaded = [];
    for (const f of files) {
      if (!(f instanceof File)) continue;
      if (f.size > 100 * 1024 * 1024) return c.json({ error: `File ${f.name} exceeds 100MB limit` }, 400);
      const buf = Buffer.from(await f.arrayBuffer());
      const asset = await saveSharedAsset(category, f.name, buf);
      uploaded.push({ ...asset, url: `/api/shared-assets/${category}/${encodeURIComponent(asset.name)}` });
    }
    if (uploaded.length === 0) return c.json({ error: "No files provided" }, 400);
    return c.json({ uploaded });
  } catch (e: any) {
    return c.json({ error: e.message ?? "Upload failed" }, 500);
  }
});

apiRoutes.delete("/api/shared-assets/:category/:file", async (c) => {
  const category = c.req.param("category");
  const file = c.req.param("file");
  try {
    await deleteSharedAsset(category, file);
    return c.json({ deleted: true });
  } catch (e: any) {
    if (e.code === "ENOENT") return c.json({ error: "File not found" }, 404);
    if (e.message?.includes("Invalid")) return c.json({ error: e.message }, 400);
    return c.json({ error: "Delete failed" }, 500);
  }
});

// GET /api/interests — 获取用户兴趣列表
apiRoutes.get("/api/interests", async (c) => {
  const config = await loadConfig();
  return c.json({ interests: config.interests ?? [] });
});

// PUT /api/interests — 更新用户兴趣列表
apiRoutes.put("/api/interests", async (c) => {
  try {
    const body = await c.req.json<{ interests: string[] }>();
    const current = await loadConfig();
    const interests = body.interests ?? [];
    await saveConfig({ ...current, interests });
    return c.json({ success: true, interests });
  } catch (err) {
    return c.json({ error: "Failed to save interests" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Trend Research via Claude CLI
// ---------------------------------------------------------------------------

/** Run claude CLI with a prompt and return the text result. */
function runCliBrief(prompt: string, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--output-format", "json",
      "--dangerously-skip-permissions",
      "--model", "haiku",
    ];

    const proc = spawn("claude", args, {
      cwd: homedir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli" },
    });

    let stdout = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.on("exit", (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`CLI exited with code ${code}`));
        return;
      }
      try {
        const envelope = JSON.parse(stdout);
        resolve(envelope.result ?? "");
      } catch {
        resolve(stdout);
      }
    });
    proc.on("error", reject);
    setTimeout(() => { try { proc.kill(); } catch {} reject(new Error("Timeout")); }, timeoutMs);
  });
}

async function researchTrends(platforms: string[]): Promise<{ collected: string[]; errors: string[] }> {
  const collected: string[] = [];
  const errors: string[] = [];

  // Load user interests once for all platforms
  const config = await loadConfig();
  const interests = config.interests ?? [];
  const interestClause = interests.length > 0
    ? `\n用户特别关注以下领域：${interests.join("、")}。请优先覆盖这些领域的趋势，同时也包含其他热门方向。\n`
    : '';

  for (const platform of platforms) {
    const platformLabel = platform === "xiaohongshu" ? "小红书" : platform === "douyin" ? "抖音" : platform;

    // Run script for real-time data
    const scriptData = await runTrendScript(platform);
    const dataClause = scriptData
      ? `\n以下是通过 API 获取的 ${platformLabel} 实时热搜数据，请以此为基础进行分析：\n\`\`\`json\n${scriptData.slice(0, 4000)}\n\`\`\`\n`
      : `\n无法通过 API 获取实时数据，请使用 WebSearch 搜索最新热搜信息。\n`;

    const prompt = [
      `你是一个专业的社交媒体趋势研究员。请分析 ${platformLabel} 平台当前最热门的内容趋势。`,
      dataClause,
      interestClause,
      `如果上面的 API 数据不够充分，请使用 WebSearch 补充搜索：`,
      `- "${platformLabel} 爆款内容 趋势 2026"`,
      `- "${platformLabel} 热门话题 最新"`,
      ``,
      `根据所有信息，输出以下 JSON 格式（只输出 JSON，不要其他文字）：`,
      `{"topics":[{`,
      `  "title":"话题标题",`,
      `  "heat":4,`,
      `  "competition":"中",`,
      `  "opportunity":"金矿",`,
      `  "description":"趋势描述和为什么值得做",`,
      `  "tags":["推荐标签1","推荐标签2","推荐标签3"],`,
      `  "contentAngles":["切入角度1","切入角度2"],`,
      `  "exampleHook":"爆款开头示例，如：你绝对想不到...",`,
      `  "category":"所属领域"`,
      `}]}`,
      ``,
      `要求：`,
      `- topics 至少 10 个`,
      `- heat 为 1-5 整数`,
      `- competition 为 "低"/"中"/"高"`,
      `- opportunity 为 "金矿"(高热低竞)/"蓝海"(低热低竞)/"红海"(高热高竞)`,
      `- tags 3-5 个平台推荐标签`,
      `- contentAngles 2-3 个具体的内容切入角度`,
      `- exampleHook 一句话的爆款开头示例`,
      `- category 为话题所属领域（如 美食/科技/穿搭/生活/情感/职场/健身/旅行/宠物/教育）`,
    ].join("\n");

    try {
      const result = await runCliBrief(prompt);
      const stripped = result.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
      const firstBrace = stripped.indexOf("{");
      const lastBrace = stripped.lastIndexOf("}");
      if (firstBrace < 0 || lastBrace <= firstBrace) {
        errors.push(platform);
        continue;
      }

      const data = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
      if (!data.topics || !Array.isArray(data.topics)) {
        errors.push(platform);
        continue;
      }

      const trendsDir = join(homedir(), ".autoviral", "trends", platform);
      await mkdir(trendsDir, { recursive: true });
      const dateStr = new Date().toISOString().slice(0, 10);
      await writeFile(
        join(trendsDir, `${dateStr}.yaml`),
        yaml.dump(data, { lineWidth: -1 }),
        "utf-8"
      );

      collected.push(platform);
    } catch {
      errors.push(platform);
    }
  }

  return { collected, errors };
}

// GET /api/trends/:platform — return latest trend data (prefer data.json, fall back to YAML)
apiRoutes.get("/api/trends/:platform", async (c) => {
  const platform = c.req.param("platform");
  const trendsDir = join(homedir(), ".autoviral", "trends", platform);

  // Try data.json first (written by agent)
  try {
    const raw = await readFile(join(trendsDir, "data.json"), "utf-8");
    return c.json(JSON.parse(raw));
  } catch { /* fall through */ }

  // Fall back to dated YAML files
  try {
    const files = await readdir(trendsDir);
    const yamlFiles = files.filter(f => f.endsWith(".yaml")).sort().reverse();
    if (yamlFiles.length === 0) return c.json({ error: "No trend data available" }, 404);
    const raw = await readFile(join(trendsDir, yamlFiles[0]), "utf-8");
    const data = yaml.load(raw);
    return c.json(data);
  } catch {
    return c.json({ error: "No trend data available" }, 404);
  }
});

// GET /api/trends/:platform/report — return the markdown research report
apiRoutes.get("/api/trends/:platform/report", async (c) => {
  const platform = c.req.param("platform");
  try {
    const reportPath = join(homedir(), ".autoviral", "trends", platform, "report.md");
    const report = await readFile(reportPath, "utf-8");
    return c.text(report);
  } catch {
    return c.text("", 404);
  }
});

// POST /api/trends/refresh — trigger research collection
apiRoutes.post("/api/trends/refresh", async (c) => {
  try {
    const body = await c.req.json<{ platforms?: string[] }>().catch(() => ({}));
    const platforms = (body as any).platforms ?? ["xiaohongshu", "douyin"];
    const result = await researchTrends(platforms);
    return c.json({ triggered: true, type: "research", ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Collection failed" }, 500);
  }
});

// POST /api/trends/refresh-stream — streaming trend research via WsBridge
apiRoutes.post("/api/trends/refresh-stream", async (c) => {
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const body = await c.req.json<{ platform?: string; interests?: string[]; competitors?: string[] }>().catch(() => ({}));
    const platform = (body as any).platform ?? "douyin";
    const platformLabel = platform === "xiaohongshu" ? "小红书" : platform === "douyin" ? "抖音" : platform;

    const sessionKey = `trends_${platform}_${Date.now()}`;

    // 1. Get user interests and competitors
    const config = await loadConfig();
    const reqInterests = (body as any).interests ?? config.interests ?? [];
    const interests = reqInterests as string[];
    const competitors = ((body as any).competitors ?? []) as string[];
    const interestClause = interests.length > 0
      ? `\n用户特别关注以下领域：${interests.join("、")}。请优先覆盖这些领域的趋势，同时也包含其他热门方向。\n`
      : '';
    const competitorClause = competitors.length > 0
      ? `\n用户关注的竞品账号：${competitors.join("、")}。请参考这些账号的内容方向和爆款模式。\n`
      : '';

    // 2. Run script for real-time data
    const scriptData = await runTrendScript(platform);
    const dataClause = scriptData
      ? `\n以下是通过 API 获取的 ${platformLabel} 实时热搜数据，请以此为基础进行分析：\n\`\`\`json\n${scriptData.slice(0, 4000)}\n\`\`\`\n`
      : `\n无法通过 API 获取实时数据，请使用 WebSearch 搜索最新热搜信息。\n`;

    // 3. Build enhanced prompt — agent writes files to trends output dir
    const outputDir = join(homedir(), ".autoviral", "trends", platform);
    const dataFile = join(outputDir, "data.json");
    const reportFile = join(outputDir, "report.md");

    const prompt = [
      `你是一个专业的社交媒体趋势研究员。请分析 ${platformLabel} 平台当前最热门的内容趋势。`,
      dataClause,
      interestClause,
      competitorClause,
      ``,
      `## 核心创作方向（强制执行）`,
      ``,
      `每个推荐的话题/方向必须能触发以下四种情绪中的至少一种，否则不予推荐：`,
      `1. **焦虑**（落后焦虑/错过焦虑/被替代焦虑/身份下坠焦虑）— 让观众觉得"我是不是落后了"`,
      `2. **愤怒**（不公/冒犯/双标/欺骗/价值观冲突）— 让观众觉得"这不对/凭什么"`,
      `3. **搞笑/抽象**（反转/共鸣/错位）— 让观众笑出来想转发`,
      `4. **羡慕**（想成为/想拥有）— 让观众觉得"我也想要这样的生活"`,
      ``,
      `每个话题必须在 JSON 中标注 "emotionType"（焦虑/愤怒/搞笑/羡慕）和 "emotionSubtype"（具体子类型）。`,
      ``,
      `如果上面的 API 数据不够充分，请使用 WebSearch 补充搜索：`,
      `- "${platformLabel} 爆款内容 趋势 2026"`,
      `- "${platformLabel} 热门话题 最新"`,
      ``,
      `完成分析后，请将结果写入以下两个文件：`,
      ``,
      `**文件 1: ${dataFile}**`,
      `写入 JSON 格式的结构化趋势数据：`,
      `{"topics":[{`,
      `  "title":"话题标题",`,
      `  "heat":4,`,
      `  "competition":"中",`,
      `  "opportunity":"金矿",`,
      `  "emotionType":"焦虑",`,
      `  "emotionSubtype":"被替代焦虑",`,
      `  "description":"趋势描述和为什么值得做",`,
      `  "tags":["推荐标签1","推荐标签2","推荐标签3"],`,
      `  "contentAngles":["切入角度1","切入角度2"],`,
      `  "exampleHook":"爆款开头示例",`,
      `  "category":"所属领域"`,
      `}]}`,
      `- topics 至少 10 个`,
      `- heat 为 1-5 整数，competition 为 "低"/"中"/"高"`,
      `- opportunity 为 "金矿"(高热低竞)/"蓝海"(低热低竞)/"红海"(高热高竞)`,
      `- emotionType 必填，为 "焦虑"/"愤怒"/"搞笑"/"羡慕" 之一`,
      `- emotionSubtype 必填，为该情绪的具体子类型`,
      `- tags 3-5 个平台推荐标签`,
      `- contentAngles 2-3 个具体的内容切入角度`,
      `- exampleHook 一句话的爆款开头示例`,
      `- category 为所属领域（美食/科技/穿搭/生活/情感/职场/健身/旅行/宠物/教育）`,
      ``,
      `**文件 2: ${reportFile}**`,
      `写入一份中文的 Markdown 格式趋势研究报告，包含：`,
      `- 标题：# ${platformLabel} 趋势研究报告`,
      `- 研究日期`,
      `- 整体趋势概述（当前平台的核心热点方向，2-3段）`,
      `- 各话题的详细分析（按热度排序，每个话题包含：为什么火、竞争情况、适合什么类型的创作者、具体的内容建议）`,
      `- 行动建议（给小创作者的 3-5 条可执行建议）`,
      ``,
      `先写 data.json，再写 report.md。两个文件都必须写入。`,
    ].join("\n");

    await wsBridge.createTrendSession(sessionKey, prompt);
    return c.json({ sessionKey, platform });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to start research" }, 500);
  }
});

// POST /api/trends/cancel/:sessionKey — cancel trend research
apiRoutes.post("/api/trends/cancel/:sessionKey", async (c) => {
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  const sessionKey = c.req.param("sessionKey");
  const killed = wsBridge.killTrendSession(sessionKey);
  return c.json({ cancelled: killed });
});

// ---------------------------------------------------------------------------
// Work Chat API (WsBridge)
// ---------------------------------------------------------------------------

// POST /api/works/:id/abort — abort running task for a work
apiRoutes.post("/api/works/:id/abort", async (c) => {
  const id = c.req.param("id");
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);
  const killed = wsBridge.killSession(id);
  return c.json({ aborted: killed });
});

// POST /api/works/:id/session
apiRoutes.post("/api/works/:id/session", async (c) => {
  const id = c.req.param("id");
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const session = wsBridge.getSession(id);
    if (session?.cliProcess) {
      return c.json({ status: "already_running", workId: id });
    }

    const work = await getWork(id);
    if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);

    const prompt = [
      `你是一个内容创作助手。你正在帮助用户创作："${work.title}"（类型：${work.type}）。`,
      `目标平台：${work.platforms.map((p: any) => typeof p === "string" ? p : p.platform).join(", ")}。`,
      work.topicHint ? `选题方向：${work.topicHint}` : "",
      ``,
      `先和用户简短打个招呼，问一句他想从哪开始（趋势调研 / 直接做素材 / 已经有 brief / 想拼成片）。`,
      `不要预设流程，按用户意图直接动手。`,
    ].filter(Boolean).join("\n");

    const config = await loadConfig();
    await wsBridge.createSession(id, prompt, config.model);
    return c.json({ status: "started", workId: id });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Session start error" }, 500);
  }
});

// POST /api/works/:id/chat
apiRoutes.post("/api/works/:id/chat", async (c) => {
  const id = c.req.param("id");
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const body = await c.req.json<{ text: string }>();
    if (!body.text) return c.json({ error: "text is required" }, 400);

    let session = wsBridge.getSession(id);
    if (!session) {
      const config = await loadConfig();
      session = await wsBridge.createSession(id, body.text, config.model);
      // Record the first user message in chat history — createSession only sends
      // the prompt to the CLI; it does NOT append a user block to messageHistory
      // or chat.jsonl. Without this, persisted chat starts at the agent's first
      // turn, missing the user's opening line. (Codex review 2026-04-27)
      wsBridge.recordUserMessage(id, body.text);
      return c.json({ sent: true, sessionCreated: true, workId: id });
    }

    const sent = await wsBridge.sendMessage(id, body.text);
    if (!sent) return c.json({ error: "Failed to send message" }, 500);
    return c.json({ sent: true, workId: id });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Chat error" }, 500);
  }
});

// ── Module-as-capability invocation ─────────────────────────────────────────

const KNOWN_MODULES = ["research", "planning", "assets", "assembly"] as const;
type ModuleName = (typeof KNOWN_MODULES)[number];

// POST /api/works/:id/invoke — module-as-capability dispatcher (no ordering)
apiRoutes.post("/api/works/:id/invoke", async (c) => {
  const id = c.req.param("id");
  let body: { module?: string; input?: unknown } = {};
  try {
    body = await c.req.json<{ module?: string; input?: unknown }>();
  } catch {
    // empty body — fall through to validation below
  }
  const mod = body.module as ModuleName | undefined;
  if (!mod || !KNOWN_MODULES.includes(mod)) {
    return c.json({ error: `module must be one of ${KNOWN_MODULES.join("|")}` }, 400);
  }

  const work = await getWork(id);
  if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);

  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 500);

  const userBrief = typeof body.input === "string"
    ? body.input
    : body.input != null ? JSON.stringify(body.input) : "(no extra brief)";
  const message = [
    `请使用 \`${mod}\` 模块的能力处理当前作品。`,
    `用户附带的输入：${userBrief}`,
    `这是一次能力调用，按你判断完成本次工作即可。`,
  ].join("\n");

  const config = await loadConfig();
  let session = wsBridge.getSession(id);
  if (!session) {
    await wsBridge.createSession(id, message, config.model);
  } else {
    await wsBridge.sendMessage(id, message);
  }

  return c.json({ triggered: true, workId: id, module: mod }, 202);
});

// GET /api/works/:id/rubric/:module — read-only rubric tool (agent self-eval).
// Returns the generic taste rubric concatenated with module-specific criteria
// (if a file exists). The agent decides whether/how to apply scores; this
// endpoint never writes state and never blocks.
const RUBRIC_FILENAMES: Record<ModuleName, string> = {
  research: "research.md",
  planning: "plan.md",     // legacy filename on disk
  assets: "assets.md",
  assembly: "assembly.md",
};

apiRoutes.get("/api/works/:id/rubric/:module", async (c) => {
  const mod = c.req.param("module") as ModuleName;
  if (!KNOWN_MODULES.includes(mod)) return c.json({ error: "Unknown module" }, 404);

  const work = await getWork(c.req.param("id"));
  if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);

  const generic = await readFile(
    join(repoRoot, "skills/autoviral/taste/06-rubric.md"),
    "utf-8",
  ).catch(() => "");
  const moduleSpecific = await readFile(
    join(repoRoot, "skills/autoviral/taste/evaluator-criteria", RUBRIC_FILENAMES[mod]),
    "utf-8",
  ).catch(() => "");

  const rubric = [generic.trim(), moduleSpecific.trim()].filter(Boolean).join("\n\n---\n\n");
  return c.json({ module: mod, rubric });
});

// ── Legacy stage-coupled routes — removed in D3 cleanup. Always 410 Gone. ──
// Migration target: POST /api/works/:id/invoke {module, input}
const D3_GONE_BODY = {
  error: "This endpoint was removed (D3). Use POST /api/works/:id/invoke {module, input} instead.",
};

apiRoutes.all("/api/works/:id/step/:step", (c) => c.json(D3_GONE_BODY, 410));
apiRoutes.all("/api/works/:id/pipeline/advance", (c) => c.json(D3_GONE_BODY, 410)); // D3-OK: 410 stub path
apiRoutes.all("/api/works/:id/evaluation-mode", (c) => c.json(D3_GONE_BODY, 410));
apiRoutes.all("/api/works/:id/eval/toggle", (c) => c.json(D3_GONE_BODY, 410));
apiRoutes.all("/api/works/:id/eval/force-pass", (c) => c.json(D3_GONE_BODY, 410));
apiRoutes.all("/api/works/:id/eval/retry", (c) => c.json(D3_GONE_BODY, 410));
apiRoutes.all("/api/works/:id/eval/results/:step", (c) => c.json(D3_GONE_BODY, 410));
apiRoutes.all("/api/works/:id/steps/:step/history", (c) => c.json(D3_GONE_BODY, 410));


// GET /api/works/:id/chat — load full conversation
apiRoutes.get("/api/works/:id/chat", async (c) => {
  const id = c.req.param("id");
  try {
    const { loadWorkChat } = await import("../work-store.js");
    const chat = await loadWorkChat(id);
    if (!chat) return c.json({ error: "No chat history" }, 404);
    return c.json(chat);
  } catch {
    return c.json({ error: "No chat history" }, 404);
  }
});

// PUT /api/works/:id/chat — save full conversation
apiRoutes.put("/api/works/:id/chat", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  try {
    const { saveWorkChat } = await import("../work-store.js");
    await saveWorkChat(id, body);
    return c.json({ saved: true });
  } catch {
    return c.json({ error: "Save failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Logs API — structured log viewer
// ---------------------------------------------------------------------------

// GET /api/logs — query structured logs
apiRoutes.get("/api/logs", async (c) => {
  const date = c.req.query("date");
  const workId = c.req.query("workId");
  const source = c.req.query("source") as any;
  const level = c.req.query("level") as any;
  const limit = parseInt(c.req.query("limit") ?? "200", 10);

  const entries = await readLogs({ date, workId, source, level, limit });
  return c.json({ entries, count: entries.length });
});

// GET /api/logs/work/:id — all logs for a specific work
apiRoutes.get("/api/logs/work/:id", async (c) => {
  const workId = c.req.param("id");
  const entries = await readLogs({ workId, limit: 500 });
  return c.json({ entries, count: entries.length });
});

// ---------------------------------------------------------------------------
// Test Runner API
// ---------------------------------------------------------------------------

// POST /api/test/run — trigger a full pipeline test run
apiRoutes.post("/api/test/run", async (c) => {
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const body = await c.req.json<RunConfig>();
    if (!body.type || !body.platform) {
      return c.json({ error: "type and platform are required" }, 400);
    }

    // Start run in background (don't await the full pipeline)
    const resultPromise = runPipeline(wsBridge, body);

    // Small delay to let runner initialize and create the work
    await new Promise(r => setTimeout(r, 500));

    // Find the active run
    const runs = await listRuns();
    const activeRun = runs.find(r => r.status === "running");

    if (activeRun) {
      // After pipeline completes, run evaluation (fire and forget)
      resultPromise.then(async (result) => {
        try {
          const evaluation = await evaluateWork(result.workId, body.type);
          result.evaluation = evaluation;
          // Re-save with evaluation
          const { writeFile, mkdir } = await import("node:fs/promises");
          const dir = join(homedir(), ".autoviral", "test-runs", result.runId);
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 2), "utf-8");
          await writeFile(join(dir, "evaluation.json"), JSON.stringify(evaluation, null, 2), "utf-8");
        } catch { /* evaluation failure is non-blocking */ }
      }).catch(() => {});

      return c.json({ runId: activeRun.runId, workId: activeRun.workId, status: "running" });
    }

    return c.json({ error: "Failed to start run" }, 500);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Run failed" }, 500);
  }
});

// GET /api/test/status/:runId — query run status
apiRoutes.get("/api/test/status/:runId", async (c) => {
  const runId = c.req.param("runId");
  const run = getRunStatus(runId) ?? await getRunReport(runId);
  if (!run) return c.json({ error: "Run not found" }, 404);
  return c.json(run);
});

// GET /api/test/runs — list all test runs
apiRoutes.get("/api/test/runs", async (c) => {
  const runs = await listRuns();
  return c.json({ runs });
});

// GET /api/test/runs/:runId/report — full report
apiRoutes.get("/api/test/runs/:runId/report", async (c) => {
  const runId = c.req.param("runId");
  const report = await getRunReport(runId);
  if (!report) return c.json({ error: "Report not found" }, 404);
  return c.json(report);
});

// ---------------------------------------------------------------------------
// Memory API (EverMemOS integration)
// ---------------------------------------------------------------------------

let _memoryClient: MemoryClient | null | undefined;
async function getMemoryClient(): Promise<MemoryClient | null> {
  if (_memoryClient === undefined) {
    _memoryClient = await MemoryClient.fromConfig();
  }
  return _memoryClient;
}

// GET /api/memory/search?q=...&method=hybrid&topK=10
apiRoutes.get("/api/memory/search", async (c) => {
  const client = await getMemoryClient();
  if (!client) return c.json({ error: "Memory not configured (missing apiKey)" }, 503);
  const q = c.req.query("q") ?? "";
  if (!q) return c.json({ error: "Missing query parameter ?q=" }, 400);
  const method = (c.req.query("method") ?? "hybrid") as "keyword" | "vector" | "hybrid" | "agentic";
  const topK = parseInt(c.req.query("topK") ?? "10", 10);
  const result = await client.search(q, { method, topK });
  return c.json(result);
});

// GET /api/memory/profile
apiRoutes.get("/api/memory/profile", async (c) => {
  const client = await getMemoryClient();
  if (!client) return c.json({ error: "Memory not configured (missing apiKey)" }, 503);
  const [style, rules] = await Promise.all([
    client.search("我的内容风格 创作偏好 个人特征", { method: "vector", topK: 10, memoryTypes: ["core", "profile"] }),
    client.search("平台规则 算法推荐 发布技巧", { method: "keyword", topK: 10 }),
  ]);
  return c.json({
    profiles: style.profiles,
    styleMemories: style.memories,
    platformRules: rules.memories,
  });
});

// GET /api/memory/context/:workId
apiRoutes.get("/api/memory/context/:workId", async (c) => {
  const client = await getMemoryClient();
  if (!client) return c.json({ error: "Memory not configured (missing apiKey)" }, 503);
  const workId = c.req.param("workId");
  const work = await getWork(workId);
  if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  const topic = work.topicHint ?? work.title;
  const firstPlatform = work.platforms?.[0];
  const platform = typeof firstPlatform === "string" ? firstPlatform : (firstPlatform as any)?.platform ?? "通用";
  const context = await client.buildContext(topic, platform);
  return c.json({ workId, topic, platform, context });
});

// ── Phase 6.C — Smart Crop / Reframe ────────────────────────────────────────
//
// POST /api/video/reframe
// Orchestrates the smart-crop Python pipeline:
//   1. saliency.py     → ROIs JSON
//   2. crop_9_16.py    → reframed mp4 in <workDir>/assets/reframed/
//   3. composition.yaml updated with new AssetEntry + reframe ProvenanceEdge
//
// Phase 6 keeps this synchronous (5–30s wait); Phase 7 turns it into a
// background job behind the render queue.

const ASPECT_VALUES = ["9:16", "1:1", "16:9", "4:5"] as const;
type AspectRatio = (typeof ASPECT_VALUES)[number];

const ReframeBody = z.object({
  workId: z.string().min(1),
  videoId: z.string().min(1),
  fromAspect: z.enum(ASPECT_VALUES),
  toAspect: z.enum(ASPECT_VALUES),
  strategy: z.enum(["face", "saliency", "center", "auto"]).optional(),
});

const TARGET_RES: Record<AspectRatio, string> = {
  "9:16": "1080x1920",
  "1:1": "1080x1080",
  "16:9": "1920x1080",
  "4:5": "1080x1350",
};

function safeTitleFromWork(title: string | undefined): string {
  return (
    (title ?? "")
      .toLowerCase()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "autoviral-export"
  );
}

apiRoutes.post("/api/video/reframe", async (c) => {
  const parsed = ReframeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.text(`invalid body: ${parsed.error.message}`, 400);
  }
  const body = parsed.data;

  const work = await getWork(body.workId);
  if (!work) return c.text(`work not found: ${body.workId}`, 404);

  const wDir = join(dataDir, "works", body.workId);
  const compYamlPath = join(wDir, "composition.yaml");
  let compRaw: string;
  try {
    compRaw = await readFile(compYamlPath, "utf-8");
  } catch {
    return c.text(`composition not found for work: ${body.workId}`, 404);
  }
  const compDoc = yaml.load(compRaw) as Composition;
  const sourceAsset = (compDoc.assets ?? []).find((a) => a.id === body.videoId);
  if (!sourceAsset) {
    return c.text(`videoId not found in composition: ${body.videoId}`, 404);
  }

  // Resolve the on-disk source path. Asset URIs follow the
  // /api/works/<workId>/assets/<rel> convention; strip the prefix and
  // re-anchor under the work directory.
  const rel = sourceAsset.uri.replace(/^\/api\/works\/[^/]+\/assets\//, "");
  const sourceAbsPath = join(wDir, "assets", rel);

  // Stage 1 — saliency.py
  const tmp = join(tmpdir(), `reframe-${body.workId}-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  const roisJsonPath = join(tmp, "rois.json");
  const saliencyScript = join(
    repoRoot,
    "skills",
    "autoviral",
    "modules",
    "assembly",
    "scripts",
    "smart_crop",
    "saliency.py",
  );
  let saliencyResult: {
    strategy_used: string;
    strategy_requested: string;
  };
  try {
    saliencyResult = await runPythonScript<{
      strategy_used: string;
      strategy_requested: string;
    }>(
      saliencyScript,
      [
        "--input",
        sourceAbsPath,
        "--output",
        roisJsonPath,
        "--strategy",
        body.strategy ?? "auto",
        "--target-aspect",
        body.toAspect,
      ],
      { timeoutMs: 60_000 },
    );
  } catch (err) {
    return c.text(String(err), 500);
  }

  // Stage 2 — crop_9_16.py
  const safeTitle = safeTitleFromWork(work.title);
  const iso = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const aspectSeg = body.toAspect.replace(":", "x");
  const outName = `${safeTitle}__${aspectSeg}__${saliencyResult.strategy_used}__${iso}.mp4`;
  const reframedDir = join(wDir, "assets", "reframed");
  await mkdir(reframedDir, { recursive: true });
  const outPath = join(reframedDir, outName);

  const cropScript = join(
    repoRoot,
    "skills",
    "autoviral",
    "modules",
    "assembly",
    "scripts",
    "smart_crop",
    "crop_9_16.py",
  );
  let cropResult: { output: string; width: number; height: number };
  try {
    cropResult = await runPythonScript<{
      output: string;
      width: number;
      height: number;
    }>(
      cropScript,
      [
        "--input",
        sourceAbsPath,
        "--rois",
        roisJsonPath,
        "--output",
        outPath,
        "--target-resolution",
        TARGET_RES[body.toAspect],
      ],
      { timeoutMs: 5 * 60_000 },
    );
  } catch (err) {
    return c.text(String(err), 500);
  }

  // Register new asset + provenance edge atomically (single yaml write).
  const newAssetId = `reframe_${Math.random().toString(36).slice(2, 10)}`;
  const newAsset: AssetEntry = {
    id: newAssetId,
    uri: `/api/works/${body.workId}/assets/reframed/${encodeURIComponent(outName)}`,
    kind: "video",
    metadata: { width: cropResult.width, height: cropResult.height },
    status: "ready",
  };
  const newEdge: ProvenanceEdge = {
    fromAssetId: body.videoId,
    toAssetId: newAssetId,
    operation: {
      type: "reframe",
      actor: "system",
      timestamp: new Date().toISOString(),
      params: {
        fromAspect: body.fromAspect,
        toAspect: body.toAspect,
        strategyRequested: saliencyResult.strategy_requested,
        strategyUsed: saliencyResult.strategy_used,
        sourceVideoUri: sourceAsset.uri,
      },
    },
  };
  compDoc.assets = [...(compDoc.assets ?? []), newAsset];
  compDoc.provenance = [...(compDoc.provenance ?? []), newEdge];
  await writeFile(compYamlPath, yaml.dump(compDoc), "utf-8");

  return c.json({
    asset: newAsset,
    edge: newEdge,
    strategyUsed: saliencyResult.strategy_used,
  });
});

// Phase 8.4 — provider listing
apiRoutes.get("/api/providers", (c) => {
  return c.json({ providers: listVideoProviders() });
});

// Phase 8.4 — provider dispatch
//
// Calls the provider adapter, then registers the resulting clip as a fresh
// AssetEntry + a "generate" ProvenanceEdge on the work's composition.yaml so
// the dive canvas / asset library pick it up immediately.
//
// fromAssetId is null because text-to-video has no source asset on disk.
apiRoutes.post("/api/providers/:providerId/generate-video", async (c) => {
  const providerId = c.req.param("providerId");
  const body = await c.req.json<{
    workId: string;
    prompt: string;
    durationSec: number;
    aspectRatio: string;
    /** R44 — image-to-video first-frame anchor. URL or data URI. Adapters
     *  that don't support i2v ignore this field and fall back to t2v. */
    firstFrameImage?: string;
    /** R44 — optional last-frame anchor for morph effects. */
    lastFrameImage?: string;
  }>();
  const provider = getVideoProvider(providerId);
  if (!provider) return c.json({ error: "unknown provider" }, 404);
  if (!body.prompt || !body.workId) {
    return c.json({ error: "prompt and workId required" }, 400);
  }
  // Compute the per-work output dir so the adapter writes the mp4 into the
  // work's asset tree (reachable via /api/works/:id/assets/<relpath>). The
  // adapter returns an absolute path; we convert to work-relative for the
  // AssetEntry.uri so existing asset-serving keeps working.
  const wDirAbs = join(dataDir, "works", body.workId);
  const seedanceDirAbs = join(wDirAbs, "assets", providerId);
  const result = await provider.generateVideo({
    prompt: body.prompt,
    durationSec: body.durationSec ?? 4,
    aspectRatio: body.aspectRatio ?? "9:16",
    outputAbsoluteDir: seedanceDirAbs,
    // R44 — i2v anchors. When provided, Seedance switches from text-only
    // to first-frame-driven generation, which is the only way to do
    // "一镜到底 + 参考人物" workflows.
    ...(body.firstFrameImage ? { firstFrameImage: body.firstFrameImage } : {}),
    ...(body.lastFrameImage ? { lastFrameImage: body.lastFrameImage } : {}),
  });
  // Convert absolute write path back to work-relative for the asset entry.
  const relativeAssetUri = result.assetUri.startsWith(wDirAbs + "/")
    ? result.assetUri.slice(wDirAbs.length + 1)
    : result.assetUri;

  // Best-effort composition update — if there's no composition.yaml yet (legacy
  // works) we still return the adapter result so the UI can show it.
  let assetId: string | null = null;
  const work = await getWork(body.workId);
  if (work) {
    const compYamlPath = join(wDirAbs, "composition.yaml");
    try {
      const compRaw = await readFile(compYamlPath, "utf-8");
      const compDoc = yaml.load(compRaw) as Composition;
      const { randomUUID } = await import("node:crypto");
      assetId = `gen_${randomUUID().slice(0, 8)}`;
      const newAsset: AssetEntry = {
        id: assetId,
        uri: relativeAssetUri,
        kind: "video",
        metadata: { duration: body.durationSec ?? 4 },
        status: "ready",
      };
      const newEdge: ProvenanceEdge = {
        fromAssetId: null,
        toAssetId: assetId,
        operation: {
          type: "generate",
          actor: "user",
          timestamp: new Date().toISOString(),
          params: {
            providerId,
            prompt: body.prompt,
            costUsd: result.costUsd,
            stub: result.stub,
            providerJobId: result.providerJobId,
          },
        },
      };
      compDoc.assets = [...(compDoc.assets ?? []), newAsset];
      compDoc.provenance = [...(compDoc.provenance ?? []), newEdge];
      await writeFile(compYamlPath, yaml.dump(compDoc), "utf-8");
    } catch {
      // composition.yaml missing or unreadable — skip registration silently.
    }
  }

  return c.json({
    assetId,
    assetUri: relativeAssetUri,
    providerJobId: result.providerJobId,
    costUsd: result.costUsd,
    stub: result.stub,
  });
});

// ── Phase 8.5 — Frame Interpolation + Super-Resolution ──────────────────────
//
// POST /api/post-process/:operation
//   :operation ∈ { "frame-interpolate", "super-resolve", "lip-sync" }
//   body: { workId, assetId, audioAssetId?, options? }
//     - lip-sync REQUIRES audioAssetId (resolved → opts.audioPath); other ops ignore it.
// Stub-only ship: when the corresponding model env var is unset / missing,
// the adapter copies input → output and flags the result with stub:true.
// We still register the resulting asset + a "grade" provenance edge so the
// downstream UI can show the variant (with a STUB badge when applicable).

const POST_PROCESSORS: Record<string, PostProcessor> = {
  "frame-interpolate": interpolateProcessor,
  "super-resolve": superResolveProcessor,
  "lip-sync": lipSyncProcessor,
};

const PostProcessBody = z.object({
  workId: z.string().min(1),
  assetId: z.string().min(1),
  audioAssetId: z.string().min(1).optional(),
  options: z
    .object({
      scale: z.union([z.literal(2), z.literal(4)]).optional(),
    })
    .optional(),
});

apiRoutes.post("/api/post-process/:operation", async (c) => {
  const operation = c.req.param("operation");
  const processor = POST_PROCESSORS[operation];
  if (!processor) {
    return c.json({ error: `unknown operation: ${operation}` }, 400);
  }

  const parsed = PostProcessBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: `invalid body: ${parsed.error.message}` }, 400);
  }
  const body = parsed.data;

  const work = await getWork(body.workId);
  if (!work) return c.json({ error: `work not found: ${body.workId}` }, 404);

  const wDir = join(dataDir, "works", body.workId);
  const compYamlPath = join(wDir, "composition.yaml");
  let compRaw: string;
  try {
    compRaw = await readFile(compYamlPath, "utf-8");
  } catch {
    return c.json({ error: `composition not found for work: ${body.workId}` }, 404);
  }
  const compDoc = yaml.load(compRaw) as Composition;
  const sourceAsset = (compDoc.assets ?? []).find((a) => a.id === body.assetId);
  if (!sourceAsset) {
    return c.json({ error: `assetId not found in composition: ${body.assetId}` }, 404);
  }

  // Resolve the on-disk source path; same convention as /api/video/reframe.
  const rel = sourceAsset.uri.replace(/^\/api\/works\/[^/]+\/assets\//, "");
  const sourceAbsPath = join(wDir, "assets", rel);

  const sourceExt = extname(rel) || ".mp4";
  const safeTitle = safeTitleFromWork(work.title);
  const iso = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const outName = `${safeTitle}__${operation}__${iso}${sourceExt}`;
  const outDir = join(wDir, "assets", "post-process");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, outName);

  const opts: PostProcessOptions = body.options ?? {};

  // lip-sync needs a second input (audio). Resolve audioAssetId → opts.audioPath.
  if (operation === "lip-sync") {
    if (!body.audioAssetId) {
      return c.json(
        { error: "lip-sync requires audioAssetId in request body" },
        400,
      );
    }
    const audioAsset = (compDoc.assets ?? []).find(
      (a) => a.id === body.audioAssetId,
    );
    if (!audioAsset) {
      return c.json(
        { error: `audioAssetId not found in composition: ${body.audioAssetId}` },
        404,
      );
    }
    const audioRel = audioAsset.uri.replace(
      /^\/api\/works\/[^/]+\/assets\//,
      "",
    );
    opts.audioPath = join(wDir, "assets", audioRel);
  }
  let result: Awaited<ReturnType<PostProcessor["process"]>>;
  try {
    result = await processor.process(sourceAbsPath, outPath, opts);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }

  const newAssetId = `pp_${operation}_${Math.random().toString(36).slice(2, 10)}`;
  const newAsset: AssetEntry = {
    id: newAssetId,
    uri: `/api/works/${body.workId}/assets/post-process/${encodeURIComponent(outName)}`,
    kind: sourceAsset.kind,
    // Stub flag lives on the provenance edge; metadata stays inheritance-only
    // so it conforms to the AssetMetadata schema.
    metadata: { ...(sourceAsset.metadata ?? {}) },
    status: "ready",
  };
  const newEdge: ProvenanceEdge = {
    fromAssetId: body.assetId,
    toAssetId: newAssetId,
    operation: {
      type: "grade",
      actor: "user",
      timestamp: new Date().toISOString(),
      params: {
        operation,
        stub: result.stub,
        ...(opts.scale !== undefined ? { scale: opts.scale } : {}),
      },
    },
  };
  compDoc.assets = [...(compDoc.assets ?? []), newAsset];
  compDoc.provenance = [...(compDoc.provenance ?? []), newEdge];
  await writeFile(compYamlPath, yaml.dump(compDoc), "utf-8");

  return c.json({
    asset: newAsset,
    edge: newEdge,
    assetUri: newAsset.uri,
    stub: result.stub,
    durationMs: result.durationMs,
  });
});

/**
 * POST /api/works/:id/text-rewrite — synchronous text rewrite via OpenRouter.
 *
 * The Inspector's Copy tab needs an immediate { text } response so it can
 * splice the new copy back into the layer. The agent-based /invoke route
 * is async (202 + chat-stream), which doesn't fit that UX. This endpoint
 * is a thin pass-through to OpenRouter chat-completions; falls back to
 * 503 if no openrouter.apiKey is configured.
 */
apiRoutes.post("/api/works/:id/text-rewrite", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);

  const body = await c.req
    .json<{ current?: string; intent?: string }>()
    .catch(() => ({} as { current?: string; intent?: string }));
  const current = (body.current ?? "").trim();
  if (!current) return c.json({ error: "Missing 'current' text to rewrite" }, 400);

  const config = await loadConfig();
  const apiKey = config.openrouter?.apiKey;
  if (!apiKey) return c.json({ error: "openrouter.apiKey not configured" }, 503);

  const intent = body.intent ?? "rewrite";
  const sys =
    "You rewrite Chinese social-media headlines/captions for editorial small-red-book style. " +
    "Return ONLY the rewritten text — no preamble, no quotes, no labels. " +
    "Keep length close to the original (±20%). Preserve tone unless told otherwise.";
  const usr = intent === "rewrite-copy"
    ? `请重写下面这段文案，保持原意但更有节奏感：\n\n${current}`
    : `请基于「${intent}」改写：\n\n${current}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3271",
    },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4.5",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    return c.json({ error: `OpenRouter ${res.status}: ${errBody.slice(0, 300)}` }, 502);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) return c.json({ error: "OpenRouter returned no text" }, 502);
  return c.json({ text });
});

// GET /api/works/:id/checkpoints — list yaml snapshots for a work, newest first.
// Snapshots are taken automatically on every agent turn_complete; this is the
// read side of that. UI uses it to render a "history" dropdown for rollback.
apiRoutes.get("/api/works/:id/checkpoints", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);
  const items = await listCheckpoints(id);
  return c.json({ items });
});

// POST /api/works/:id/checkpoints/restore — overwrite the live deliverable
// with a previously-snapshotted yaml. Body: { file: "<filename>" }. The
// filename is what GET returned in `items[].file`.
apiRoutes.post("/api/works/:id/checkpoints/restore", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);
  const body = await c.req
    .json<{ file?: string }>()
    .catch(() => ({} as { file?: string }));
  const file = ((body.file as string | undefined) ?? "").trim();
  if (!file) return c.json({ error: "Missing 'file'" }, 400);
  const out = await restoreCheckpoint(id, file);
  if (!out) return c.json({ error: "Checkpoint not found or invalid name" }, 404);
  return c.json({ ok: true, deliverable: out.deliverable });
});

// POST /api/works/:id/checkpoints — manual snapshot trigger. Useful before
// the user is about to ask the agent for a risky change. Idempotent: if the
// yaml hasn't changed since the latest snapshot, returns an empty list.
apiRoutes.post("/api/works/:id/checkpoints", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);
  const written = await createCheckpoint(id);
  return c.json({ written });
});

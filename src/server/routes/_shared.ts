// Shared infrastructure for the split api.ts domain sub-routers (I11).
//
// api.ts was a 3270-line god-module. I11 split it into per-domain sub-routers
// under src/server/routes/. This module holds the cross-domain glue those
// routers all need: the process-lifetime mutable singletons (WsBridge /
// RenderQueue, set once by server/index.ts after construction), the shared
// MIME / asset-security helpers, the upload-size guard, the secret-redaction
// sweep, the legacy composition/carousel synthesisers, and a few small
// utilities. Moving these here keeps the per-domain routers free of duplicated
// boilerplate and preserves the single-source-of-truth invariants the original
// file documented (one MAX_UPLOAD_BYTES, one SECRET_PATHS sweep, etc.).
//
// PURE structural move — every symbol here is verbatim from the pre-split
// api.ts. No behaviour, path, or contract changed.

import { bodyLimit } from "hono/body-limit";
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, extname } from "node:path";
import { type Config } from "../../infra/config.js";
import { PACKAGE_ROOT } from "../../infra/paths.js";
import { FFPROBE_BIN } from "../ffmpeg-paths.js";
import { dataDir } from "../../infra/config.js";
import type { WsBridge } from "../../ws-bridge.js";
import type { RenderQueue, RenderJob } from "../render-queue/index.js";
import {
  type Composition,
  type AssetEntry,
  type ProvenanceEdge,
  newTrackId,
} from "../../shared/composition.js";
import { isWorkType, getContentType } from "../../shared/content-types/registry.js";

// ── Python script runner for real-time trend data ────────────────────────────

export const execFileAsync = promisify(execFile);

export async function runTrendScript(platform: string): Promise<string> {
  // Anchor on PACKAGE_ROOT (not process.cwd()) so it resolves in a packaged app.
  // NOTE: skills/autoviral/modules/ was DELETED in the agentic-terminal refactor
  // (see CLAUDE.md / ADR-004), so these research scripts no longer ship. Rather
  // than spawn a nonexistent script (which would throw an opaque ENOENT), we
  // detect the missing script and degrade gracefully: returning '' makes the
  // caller fall back to live WebSearch (see the `dataClause` ternary at the call
  // site). TODO(agentic-terminal): if real-time trend ingestion is revived, port
  // these to the new skill layout and drop this guard.
  const scriptsDir = join(PACKAGE_ROOT, 'skills', 'autoviral', 'modules', 'research', 'scripts');
  const script = platform === 'douyin' ? 'douyin_hot_search.py' : 'newsnow_trends.py';
  const scriptPath = join(scriptsDir, script);

  const { existsSync } = await import("node:fs");
  if (!existsSync(scriptPath)) {
    console.warn(
      `[trends] research script unavailable (${scriptPath}); falling back to WebSearch`,
    );
    return '';
  }

  try {
    if (platform === 'douyin') {
      const { stdout } = await execFileAsync('python3', [
        scriptPath, '--top', '30'
      ], { timeout: 30000 });
      return stdout;
    }
    // Other platforms via newsnow
    const { stdout } = await execFileAsync('python3', [
      scriptPath, platform, '--top', '20'
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
  // Phase B (2026-05-25): serve <audio>.peaks.json with json mime so the
  // frontend useWaveform JSON fast-path sees the correct content-type.
  ".json": "application/json",
};

export function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// #52 — security headers for served user/agent-uploaded assets. Defends the
// stored-XSS vector where an uploaded SVG with an inline <script> executes in
// the app's own origin when its URL is navigated to directly.
export function assetSecurityHeaders(mimeType: string): Record<string, string> {
  const headers: Record<string, string> = {
    // Never let the browser sniff a declared type into a more dangerous one
    // (e.g. an uploaded "image" that is actually HTML being rendered as HTML).
    "X-Content-Type-Options": "nosniff",
  };
  if (mimeType === "image/svg+xml") {
    // An SVG loaded as a top-level document (direct navigation / <iframe> /
    // <object>) runs embedded <script> + event handlers → same-origin XSS.
    // A locked-down CSP plus `sandbox` (no allow-scripts) disables script
    // execution while the vector still renders shapes + inline styles. SVGs
    // referenced via <img src> are unaffected — browsers already run those in
    // a script-disabled "secure static" mode. This covers ANY path a malicious
    // SVG lands on disk (user upload OR agent prompt-injection), not just the
    // upload endpoint's allowlist.
    headers["Content-Security-Policy"] =
      "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  }
  return headers;
}

// #52 — extension allowlist for the asset upload endpoint. Media only; markup /
// script / arbitrary types are rejected at the door so they never reach disk.
// SVG is allowed (it's a legitimate image format the library accepts) but is
// neutralised on the way out by assetSecurityHeaders.
export const ALLOWED_UPLOAD_EXTS = new Set<string>([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", // images
  ".mp4", ".webm", ".mov", ".m4v",                  // video
  ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",  // audio
]);

// #67 — single source of truth for the upload size cap. BOTH upload endpoints
// (/works/:id/assets/upload and /shared-assets/:category) use it so the limit
// can't drift apart again (before this, only shared-assets had a 100MB cap; the
// per-work endpoint had none → a multi-GB drag-in could OOM the single-process
// workstation, taking down every work + the render queue + agent sessions).
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

// #67 — the REAL OOM guard. `parseBody()` buffers the entire multipart body into
// heap, so a `file.size` check inside the handler runs AFTER the spike already
// happened. bodyLimit rejects via Content-Length BEFORE any body is read (the
// normal browser-upload case), and streams-with-a-counter otherwise. onError
// returns a localizable errorCode instead of the default plain "Payload Too
// Large" text. Applied as per-route middleware on both upload endpoints.
export const uploadBodyLimit = bodyLimit({
  maxSize: MAX_UPLOAD_BYTES,
  onError: (c) =>
    c.json(
      { error: `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB upload limit`, errorCode: "asset_too_large" },
      413,
    ),
});

// ── WsBridge accessor (set by server/index.ts after construction) ─────────
let wsBridge: WsBridge | null = null;

export function setWsBridge(bridge: WsBridge): void {
  wsBridge = bridge;
}

/** Read the process-lifetime WsBridge singleton (null until index.ts sets it). */
export function getWsBridge(): WsBridge | null {
  return wsBridge;
}

// ── RenderQueue accessor (set by server/index.ts after construction) ──────
// Phase 7.B — POST /api/works/:id/render now enqueues into this queue
// instead of running the pipeline synchronously.
let renderQueue: RenderQueue | null = null;

export function setRenderQueue(q: RenderQueue | null): void {
  renderQueue = q;
}

/** Read the process-lifetime RenderQueue singleton (null until index.ts sets it). */
export function getRenderQueue(): RenderQueue | null {
  return renderQueue;
}

// ── Secret redaction (GET /api/config) ──────────────────────────────────────
// R109 F475 + #60 — server-side secret redaction. The GET endpoint NEVER
// returns plaintext credentials; each secret becomes a `secretMeta[k] =
// { set, lastFour }` entry so the UI can show a "currently stored ····XXXX"
// hint without the secret ever entering browser memory.
//
// SECRET_PATHS is the single sweep that enumerates EVERY credential-bearing
// path in the config. The GET handler (a) strips each secret-bearing nested
// object from the spread so no plaintext escapes, and (b) builds secretMeta
// from this list. Before #60 only `openrouterKey` was redacted while the raw
// `...config` spread leaked jimeng.accessKey/secretKey and memory.apiKey in
// plaintext — the classic "redacted one field, forgot the rest" sweep-gate
// drift. Add a new secret to the config → add ONE line here and it is covered
// everywhere (response strip + meta) at once.
export const SECRET_PATHS = [
  { metaKey: "openrouterKey", read: (c: Config) => c.openrouter?.apiKey },
  { metaKey: "jimengAccessKey", read: (c: Config) => c.jimeng?.accessKey },
  { metaKey: "jimengSecretKey", read: (c: Config) => c.jimeng?.secretKey },
  { metaKey: "memoryApiKey", read: (c: Config) => c.memory?.apiKey },
] as const;

// Nested config keys whose entire object is credential-bearing and must be
// dropped from the GET response spread. (memory.syncEnabled — the only
// non-secret field any client reads — is surfaced explicitly below.)
export const SECRET_BEARING_KEYS = ["openrouter", "jimeng", "memory"] as const;

// PUT-editable secret flat fields: empty string in the body means "leave the
// stored value alone" so the user can save other fields without re-typing
// keys. Only openrouterKey is editable via the Settings UI today.
export const SECRET_FIELDS = ["openrouterKey"] as const;

function maskTail(s: string): string {
  if (!s) return "";
  if (s.length <= 4) return "•".repeat(s.length);
  return s.slice(-4);
}

/** Build the redacted secretMeta map by sweeping SECRET_PATHS. */
export function buildSecretMeta(config: Config): Record<string, { set: boolean; lastFour: string }> {
  const meta: Record<string, { set: boolean; lastFour: string }> = {};
  for (const { metaKey, read } of SECRET_PATHS) {
    const v = read(config) ?? "";
    meta[metaKey] = { set: !!v, lastFour: maskTail(v) };
  }
  return meta;
}

// ── Render-job dedup helpers (work delete + render enqueue) ──────────────────

// #63 — cancel a work's in-flight render jobs (queued/running) so the render
// worker stops writing into works/<id>/output/ BEFORE the directory is deleted.
// Terminal jobs (done/failed/cancelled) are left untouched. cancel() aborts the
// ffmpeg/Remotion subprocess via AbortSignal (#44), so it exits cleanly instead
// of racing the rm -rf. Returns the ids it cancelled (for logging/testing).
// Exported so the cancel-selection logic can be unit-tested with a fake queue.
export function cancelInFlightRenders(
  queue: Pick<RenderQueue, "list" | "cancel">,
  workId: string,
): string[] {
  const cancelled: string[] = [];
  for (const job of queue.list(workId)) {
    if (job.status === "queued" || job.status === "running") {
      queue.cancel(job.id);
      cancelled.push(job.id);
    }
  }
  return cancelled;
}

// #62 — the work's currently-active (queued|running) render job, if any. A
// render is a multi-minute job and the queue has no per-work serialization, so
// without this a double-click (second POST before the first job leaves the
// queue) enqueues a SECOND parallel render and orphans the first (the client's
// ExportProgress only tracks the latest jobId). Exported for testing.
export function findActiveRenderJob(
  queue: Pick<RenderQueue, "list">,
  workId: string,
): RenderJob | null {
  return (
    queue.list(workId).find((j) => j.status === "queued" || j.status === "running") ?? null
  );
}

// ── Legacy composition / carousel synthesisers ───────────────────────────────

export async function synthesiseLegacyComposition(
  workId: string,
  workType: string,
): Promise<unknown | null> {
  // I06 / ADR-006 — this synthesiser only applies to works whose deliverable
  // is composition.yaml. Dispatch off the registry manifest instead of a bare
  // literal so a new content type can't silently fall through here.
  if (!isWorkType(workType) || getContentType(workType).deliverableFile !== "composition.yaml")
    return null;
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
      const { stdout } = await execFileAsync(FFPROBE_BIN, [
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
      { id: newTrackId(), kind: "video", label: "V1", displayOrder: 0, muted: false, hidden: false, clips: videoClips },
      { id: newTrackId(), kind: "audio", label: "A1 · BGM", displayOrder: 1, muted: false, hidden: false, clips: audioClips },
      { id: newTrackId(), kind: "text", label: "CC1", displayOrder: 2, language: "zh", muted: false, hidden: false, clips: [] },
      { id: newTrackId(), kind: "overlay", label: "Overlay", displayOrder: 3, muted: false, hidden: false, clips: [] },
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

export async function synthesiseLegacyCarousel(
  workId: string,
  workType: string,
): Promise<unknown | null> {
  // I06 / ADR-006 — applies only to works whose deliverable is carousel.yaml.
  if (!isWorkType(workType) || getContentType(workType).deliverableFile !== "carousel.yaml")
    return null;
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

// ── Reframe / post-process shared util ───────────────────────────────────────

export function safeTitleFromWork(title: string | undefined): string {
  return (
    (title ?? "")
      .toLowerCase()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "autoviral-export"
  );
}

// ── Research collection (manual refresh + scheduler share this) ──────────────

// #64 — exported so the research scheduler (src/research-scheduler.ts) runs the
// EXACT same collection as the manual POST /api/trends/refresh, keeping scheduled
// and manual research identical.
export async function researchTrends(platforms: string[]): Promise<{ collected: string[]; errors: string[] }> {
  const { collectPlatform, defaultPipelineDeps } = await import("../../trends/pipeline.js");
  const { writeValidatedTrendsYaml } = await import("../../trends/write.js");
  const { gcOldCovers, coversDir } = await import("../../trends/covers.js");
  const { runCliBrief } = await import("../../cli-brief.js");
  const { homedir } = await import("node:os");
  const collected: string[] = [];
  const errors: string[] = [];
  const deps = defaultPipelineDeps(runCliBrief);
  for (const platform of platforms) {
    if (!["youtube", "tiktok", "xiaohongshu", "douyin"].includes(platform)) {
      errors.push(`${platform} (unsupported)`);
      continue;
    }
    try {
      const result = await collectPlatform(platform as any, deps);
      if (result.pipelineStatus !== "ok") {
        errors.push(`${platform} (${result.errors.join("; ")})`);
        continue;
      }
      const trendsDir = join(homedir(), ".autoviral", "trends", platform);
      const dateStr = new Date().toISOString().slice(0, 10);
      const w = await writeValidatedTrendsYaml(trendsDir, dateStr, result);
      if (!w.written) {
        errors.push(`${platform} (write-failed: ${w.issues.map(i => i.path).join(",")})`);
        continue;
      }
      await gcOldCovers(coversDir(platform), 80);
      collected.push(platform);
    } catch (e) {
      errors.push(`${platform} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return { collected, errors };
}

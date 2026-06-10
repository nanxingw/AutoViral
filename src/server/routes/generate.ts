// Generate domain sub-router (I11): provider-based image/video generation,
// batch frame candidates + frame selection, provider listing/dispatch, the
// reframe (smart-crop) pipeline, and the frame-interpolate / super-resolve /
// lip-sync post-processors. Split verbatim from api.ts — no behaviour/path
// change.

import { Hono } from "hono";
import { readFile, writeFile, mkdir, readdir, rename, copyFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { z } from "zod";
import { dataDir, repoRoot, loadConfig } from "../../infra/config.js";
import { getWork } from "../../domain/work-store.js";
import { readCompositionFor } from "../bridge/composition-ops.js";
import { getProvider, getDefaultProvider, listProviders } from "../../providers/registry.js";
import { FFMPEG_BIN } from "../ffmpeg-paths.js";
import {
  closestSupportedRatio,
  SUPPORTED_VIDEO_ASPECT_RATIOS,
  SUPPORTED_VIDEO_RESOLUTIONS,
  SUPPORTED_VIDEO_DURATIONS,
} from "../../providers/video/seedance.js";
import type { VideoGenerateResult } from "../../providers/video/types.js";
import { resolveAssetPath, UnsafePathError, SAFE_ID } from "../safe-paths.js";
import { uiEventBus } from "../bridge/ui-events.js";
import { runPythonScript } from "../python-bridge.js";
import { interpolateProcessor } from "../post-process/interpolate.js";
import { superResolveProcessor } from "../post-process/super-resolve.js";
import { lipSyncProcessor } from "../post-process/lip-sync.js";
import type { PostProcessor, PostProcessOptions } from "../post-process/types.js";
import {
  type Composition,
  type AssetEntry,
  type ProvenanceEdge,
} from "../../shared/composition.js";
import { safeTitleFromWork } from "./_shared.js";

export const generateRouter = new Hono();

// ---------------------------------------------------------------------------
// Generate API (Provider-based image/video generation)
// ---------------------------------------------------------------------------

/**
 * Register a freshly-generated video clip as an AssetEntry + a "generate"
 * ProvenanceEdge on the work's composition.yaml. Shared by both video-gen
 * endpoints (POST /api/generate/video and POST /api/providers/:id/generate-video)
 * so the on-disk shape is identical. Best-effort: returns null (no throw) when
 * the work / composition.yaml is missing or unreadable, so registration failure
 * never blocks the adapter response. actor stays "user" to keep the existing
 * provenance vocabulary unchanged.
 */
async function registerGeneratedVideoAsset(args: {
  workId: string;
  relativeAssetUri: string;
  providerId: string;
  prompt: string;
  result: VideoGenerateResult;
  /** Extra provenance params merged into the edge (e.g. aspectRatio/resolution/durationSec). */
  extraParams?: Record<string, unknown>;
  /** Duration in seconds for the asset metadata. */
  durationSec?: number;
}): Promise<string | null> {
  const { workId, relativeAssetUri, providerId, prompt, result } = args;
  const work = await getWork(workId);
  if (!work) return null;
  const wDirAbs = join(dataDir, "works", workId);
  const compYamlPath = join(wDirAbs, "composition.yaml");
  try {
    const compRaw = await readFile(compYamlPath, "utf-8");
    const compDoc = yaml.load(compRaw) as Composition;
    const { randomUUID } = await import("node:crypto");
    const assetId = `gen_${randomUUID().slice(0, 8)}`;
    const newAsset: AssetEntry = {
      id: assetId,
      uri: relativeAssetUri,
      kind: "video",
      metadata: { duration: args.durationSec ?? 4 },
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
          prompt,
          costUsd: result.costUsd,
          stub: result.stub,
          providerJobId: result.providerJobId,
          ...(args.extraParams ?? {}),
        },
      },
    };
    compDoc.assets = [...(compDoc.assets ?? []), newAsset];
    compDoc.provenance = [...(compDoc.provenance ?? []), newEdge];
    await writeFile(compYamlPath, yaml.dump(compDoc), "utf-8");
    return assetId;
  } catch {
    // composition.yaml missing or unreadable — skip registration silently.
    return null;
  }
}

// POST /api/generate/image
generateRouter.post("/api/generate/image", async (c) => {
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
  const provider = providerName ? getProvider("image", providerName) : getDefaultProvider("image");
  if (!provider) {
    return c.json({ success: false, error: "No image provider available", code: "INVALID_PARAMS" }, 400);
  }
  // Canvas-follow default (user decision 2026-06-10): when the caller gives no
  // explicit sizing (aspectRatio / width / height), fall back to the work's OWN
  // composition aspect — the canvas the user picked for this work — instead of
  // the model's hidden 1024×1024 square. Explicit params always win; works
  // without a composition.yaml (carousel) keep the model default. No platform
  // hard-coding anywhere: 抖音 work with a 16:9 canvas generates 16:9.
  let effectiveAspectRatio = aspectRatio;
  if (!effectiveAspectRatio && !width && !height) {
    try {
      const comp = await readCompositionFor({ workId });
      effectiveAspectRatio = comp.aspect;
    } catch {
      /* no composition — model default applies */
    }
  }
  try {
    const result = await provider.generateImage({
      prompt, width, height, workId, filename: safeFilename, referenceImage,
      aspectRatio: effectiveAspectRatio, imageSize, seed, temperature, model,
    });
    // I17 — broadcast asset-added so the Studio library refreshes live without
    // a page reload. Mirrors the audio path's shape (audio.ts:279): same
    // {type,workId,ts,payload:{kind,uri,origin}}. Only fires on success. The
    // provider returns an absolute assetPath, so convert it to a work-relative
    // uri like the video paths do — keeping every asset-added uri consistent.
    if (result.success && result.assetPath) {
      const wDirAbs = join(dataDir, "works", workId);
      const relativeUri = result.assetPath.startsWith(wDirAbs + "/")
        ? result.assetPath.slice(wDirAbs.length + 1)
        : result.assetPath;
      uiEventBus.publish(workId, {
        type: "asset-added",
        workId,
        ts: Date.now(),
        payload: { kind: "image", uri: relativeUri, origin: "generate" },
      });
    }
    return c.json(result);
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/generate/video
generateRouter.post("/api/generate/video", async (c) => {
  const body = await c.req.json();
  const {
    workId, prompt, firstFrame, lastFrame, filename, provider: providerName,
    durationSec, resolution,
  } = body;
  let { aspectRatio } = body;
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

  // Legacy compat: older callers passed an aspect like "16:9"/"9:16" via the
  // `resolution` field (which now means 480p/720p/1080p). When no explicit
  // aspectRatio is set and `resolution` looks like a ratio, treat it as the
  // aspectRatio and drop it from the resolution slot.
  let effectiveResolution = resolution;
  if (!aspectRatio && typeof resolution === "string" && /^\d+:\d+$/.test(resolution)) {
    aspectRatio = resolution;
    effectiveResolution = undefined;
  }

  // Validate against the authoritative OpenRouter videos contract.
  if (durationSec !== undefined) {
    if (!Number.isInteger(durationSec) || !(SUPPORTED_VIDEO_DURATIONS as readonly number[]).includes(durationSec)) {
      return c.json({
        success: false,
        error: `durationSec must be an integer in 4-15 (got ${durationSec})`,
        code: "INVALID_PARAMS",
      }, 400);
    }
  }
  if (aspectRatio !== undefined && !(SUPPORTED_VIDEO_ASPECT_RATIOS as readonly string[]).includes(aspectRatio)) {
    return c.json({
      success: false,
      error: `aspectRatio must be one of ${SUPPORTED_VIDEO_ASPECT_RATIOS.join(", ")} (got ${aspectRatio})`,
      code: "INVALID_PARAMS",
    }, 400);
  }
  if (effectiveResolution !== undefined && !(SUPPORTED_VIDEO_RESOLUTIONS as readonly string[]).includes(effectiveResolution)) {
    return c.json({
      success: false,
      error: `resolution must be one of ${SUPPORTED_VIDEO_RESOLUTIONS.join(", ")} (got ${effectiveResolution})`,
      code: "INVALID_PARAMS",
    }, 400);
  }

  // Canvas-follow default (mirrors /api/generate/image): when the caller gives
  // no explicit aspectRatio, follow the work's OWN composition aspect, mapping
  // it onto the nearest supported video ratio (4:5 → 3:4). No composition →
  // don't send anything (gateway default). Explicit always wins.
  let effectiveAspectRatio = aspectRatio;
  if (!effectiveAspectRatio) {
    try {
      const comp = await readCompositionFor({ workId });
      effectiveAspectRatio = closestSupportedRatio(comp.aspect);
    } catch {
      /* no composition — gateway default applies */
    }
  }

  // firstFrame/lastFrame: http(s)/data URIs pass through untouched; local paths
  // are sandbox-resolved then read + base64-encoded into a data URI — a bare
  // local path means nothing to OpenRouter, so this is the prerequisite for
  // i2v to actually work. lastFrame previously bypassed sanitization entirely;
  // it's now treated identically to firstFrame.
  let firstFrameImage: string | undefined;
  let lastFrameImage: string | undefined;
  try {
    firstFrameImage = await resolveFrameImage(workId, firstFrame);
    lastFrameImage = await resolveFrameImage(workId, lastFrame);
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "INVALID_PATH" }, 400);
  }

  const provider = providerName ? getProvider("video", providerName) : getDefaultProvider("video");
  if (!provider) {
    return c.json({ success: false, error: "No video provider available", code: "INVALID_PARAMS" }, 400);
  }
  try {
    // The mp4 lands in the work's assets/<provider>/ tree so the existing
    // /api/works/:id/assets/* serving picks it up; we convert the absolute
    // write path back to a work-relative uri for the response.
    const wDirAbs = join(dataDir, "works", workId);
    const outDirAbs = join(wDirAbs, "assets", provider.name);
    const effectiveDuration = durationSec ?? 5;
    const result = await provider.generateVideo({
      prompt,
      durationSec: effectiveDuration,
      outputAbsoluteDir: outDirAbs,
      ...(effectiveAspectRatio ? { aspectRatio: effectiveAspectRatio } : {}),
      ...(effectiveResolution ? { resolution: effectiveResolution } : {}),
      ...(firstFrameImage ? { firstFrameImage } : {}),
      ...(lastFrameImage ? { lastFrameImage } : {}),
    });
    const relativeUri = result.assetUri.startsWith(wDirAbs + "/")
      ? result.assetUri.slice(wDirAbs.length + 1)
      : result.assetUri;

    // Register the clip as an AssetEntry + provenance edge so the agent can
    // `autoviral scene link` it directly (handoff promise is real now).
    const assetId = await registerGeneratedVideoAsset({
      workId,
      relativeAssetUri: relativeUri,
      providerId: provider.name,
      prompt,
      result,
      durationSec: effectiveDuration,
      extraParams: {
        ...(effectiveAspectRatio ? { aspectRatio: effectiveAspectRatio } : {}),
        ...(effectiveResolution ? { resolution: effectiveResolution } : {}),
        durationSec: effectiveDuration,
      },
    });

    // I17 — same asset-added broadcast as the image path so the library shows
    // the new clip without a reload. Mirrors audio.ts:279.
    uiEventBus.publish(workId, {
      type: "asset-added",
      workId,
      ts: Date.now(),
      payload: { kind: "video", uri: relativeUri, origin: "generate" },
    });
    return c.json({
      success: true,
      assetId,
      assetPath: result.assetUri,
      previewUrl: `/api/works/${workId}/${relativeUri}`,
      stub: result.stub,
      costUsd: result.costUsd,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

/**
 * Register a freshly-generated BGM/music track as an AssetEntry (kind:"audio")
 * + a "generate" ProvenanceEdge on the work's composition.yaml. Mirrors
 * registerGeneratedVideoAsset exactly (same shape, best-effort: returns null
 * without throwing when the work / composition.yaml is missing) so the on-disk
 * provenance vocabulary stays uniform across video / image / audio.
 */
async function registerGeneratedBgmAsset(args: {
  workId: string;
  relativeAssetUri: string;
  providerId: string;
  prompt: string;
  costUsd?: number;
  stub?: boolean;
  durationSec?: number;
  extraParams?: Record<string, unknown>;
}): Promise<string | null> {
  const { workId, relativeAssetUri, providerId, prompt } = args;
  const work = await getWork(workId);
  if (!work) return null;
  const compYamlPath = join(dataDir, "works", workId, "composition.yaml");
  try {
    const compDoc = yaml.load(await readFile(compYamlPath, "utf-8")) as Composition;
    const { randomUUID } = await import("node:crypto");
    const assetId = `gen_${randomUUID().slice(0, 8)}`;
    const newAsset: AssetEntry = {
      id: assetId,
      uri: relativeAssetUri,
      kind: "audio",
      metadata: { duration: args.durationSec ?? 0 },
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
          prompt,
          costUsd: args.costUsd,
          stub: args.stub,
          ...(args.extraParams ?? {}),
        },
      },
    };
    compDoc.assets = [...(compDoc.assets ?? []), newAsset];
    compDoc.provenance = [...(compDoc.provenance ?? []), newEdge];
    await writeFile(compYamlPath, yaml.dump(compDoc), "utf-8");
    return assetId;
  } catch {
    return null;
  }
}

/**
 * Truncate an mp3 in place to `seconds` via ffmpeg (stream-copy, no re-encode).
 * Lyria emits a full ~1–2 minute track with no duration parameter; this is how
 * the endpoint honours a caller's durationSeconds. Best-effort: on any ffmpeg
 * failure the original (full-length) file is kept rather than failing the job.
 */
async function truncateAudio(filePath: string, seconds: number): Promise<void> {
  const tmpPath = `${filePath}.cut.mp3`;
  await new Promise<void>((resolve, reject) => {
    const ff = spawn(
      FFMPEG_BIN,
      ["-y", "-loglevel", "error", "-i", filePath, "-t", String(seconds), "-c", "copy", tmpPath],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    ff.stderr.on("data", (b: Buffer | string) => { stderr += b.toString(); });
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg truncate exit ${code}\n${stderr}`));
    });
    ff.on("error", reject);
  });
  await rename(tmpPath, filePath);
}

// POST /api/generate/bgm — Lyria 3 Pro music/BGM generation (B2, PRD-0009).
// Replaces the deleted music_generate.py death-envelope path. Reads the
// OpenRouter key from config.openrouter.apiKey (NOT process.env — Settings
// writes config.yaml; works.ts:758 pattern), so a UI-configured key works even
// when the daemon's environment lacks OPENROUTER_API_KEY.
generateRouter.post("/api/generate/bgm", async (c) => {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const {
    workId, prompt, filename, vocal, seed, temperature, durationSeconds,
    provider: providerName, referenceImage,
  } = body as Record<string, any>;

  if (!workId || !prompt) {
    return c.json({ success: false, error: "Missing required fields: workId, prompt", code: "INVALID_PARAMS" }, 400);
  }
  if (!SAFE_ID.test(String(workId))) {
    return c.json({ success: false, error: "Invalid workId", code: "INVALID_PARAMS" }, 400);
  }

  // durationSeconds is OPTIONAL. Lyria has NO duration parameter (it emits a
  // full ~1–2 min track); when given, the server clamps the value (HTML
  // min/max is untrusted — #75 lesson) and ffmpeg-truncates the result. Reject
  // out-of-range values rather than silently snapping, so the caller learns the
  // bound.
  if (durationSeconds !== undefined) {
    if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds)
      || durationSeconds < 5 || durationSeconds > 180) {
      return c.json({
        success: false,
        error: `durationSeconds must be a number in 5-180 (got ${durationSeconds}). Lyria emits a full ~2min track; this only trims it.`,
        code: "INVALID_PARAMS",
      }, 400);
    }
  }

  // Validate the requested provider exists (lyria is the only music provider).
  const entry = providerName ? getProvider("music", providerName) : getDefaultProvider("music");
  if (!entry) {
    return c.json({ success: false, error: "No music provider available", code: "INVALID_PARAMS" }, 400);
  }

  // Key from config (Settings-written), NOT process.env. No key → 503.
  const config = await loadConfig();
  const apiKey = config.openrouter?.apiKey;
  if (!apiKey) {
    return c.json({ success: false, error: "openrouter.apiKey not configured", code: "NO_API_KEY" }, 503);
  }

  const safeFilename = filename
    ? String(filename).replace(/[/\\]/g, "_").replace(/^\.+/, "")
    : `bgm_${Date.now()}.mp3`;
  const finalFilename = safeFilename || `bgm_${Date.now()}.mp3`;

  const referenceImages: string[] = [];
  if (typeof referenceImage === "string" && referenceImage.trim()) referenceImages.push(referenceImage.trim());

  const wDirAbs = join(dataDir, "works", workId);
  const outDirAbs = join(wDirAbs, "assets", "audio");

  try {
    // Call the registry entry (the keyless lyria singleton in prod; a capturing
    // fake under test). The config key is injected per-call via opts.apiKey so
    // the keyless singleton serves the request with the Settings-written key.
    const result = await entry.generateMusic({
      prompt: String(prompt),
      filename: finalFilename,
      outputAbsoluteDir: outDirAbs,
      apiKey,
      ...(vocal !== undefined ? { vocal: Boolean(vocal) } : {}),
      ...(typeof seed === "number" ? { seed } : {}),
      ...(typeof temperature === "number" ? { temperature } : {}),
      ...(referenceImages.length > 0 ? { referenceImages } : {}),
    });

    // Optional truncate (best-effort) when the caller asked for a shorter clip.
    if (durationSeconds !== undefined && !result.stub) {
      try {
        await truncateAudio(result.assetUri, durationSeconds);
      } catch (err) {
        console.warn(`[bgm] truncate failed (keeping full track): ${(err as Error).message}`);
      }
    }

    const relativeUri = result.assetUri.startsWith(wDirAbs + "/")
      ? result.assetUri.slice(wDirAbs.length + 1)
      : result.assetUri;

    const assetId = await registerGeneratedBgmAsset({
      workId,
      relativeAssetUri: relativeUri,
      providerId: entry.name,
      prompt: String(prompt),
      costUsd: result.costUsd,
      stub: result.stub,
      durationSec: durationSeconds,
      extraParams: {
        vocal: Boolean(vocal),
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      },
    });

    uiEventBus.publish(workId, {
      type: "asset-added",
      workId,
      ts: Date.now(),
      payload: { kind: "audio", uri: relativeUri, origin: "generate" },
    });

    return c.json({
      success: true,
      assetId,
      relativeUri,
      assetPath: result.assetUri,
      previewUrl: `/api/works/${workId}/${relativeUri}`,
      stub: result.stub,
      costUsd: result.costUsd,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

const FRAME_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * Resolve a frame-image input to something OpenRouter can fetch: http(s)/data
 * URIs pass through; a workspace-relative local path is sandbox-resolved then
 * read + base64-encoded into a data URI. Returns undefined for an empty input;
 * throws when a local path escapes the sandbox or can't be read.
 */
async function resolveFrameImage(workId: string, frame: unknown): Promise<string | undefined> {
  if (!frame) return undefined;
  const s = String(frame);
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:")) {
    return s;
  }
  let abs: string;
  try {
    const cleaned = s.replace(/^\/+/, "");
    const root = cleaned.startsWith("output/") ? "output" : "assets";
    const rest = cleaned.startsWith("output/") ? cleaned.slice(7)
               : cleaned.startsWith("assets/") ? cleaned.slice(7) : cleaned;
    abs = resolveAssetPath(workId, root, rest);
  } catch {
    throw new Error(`Invalid frame image path: ${s}`);
  }
  const ext = extname(abs).toLowerCase();
  const mime = FRAME_MIME[ext] ?? "image/png";
  const buf = await readFile(abs);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// SAFE_ID imported from ../safe-paths.js — single source of truth

// POST /api/generate/image/batch — generate multiple candidate frames for a shot
generateRouter.post("/api/generate/image/batch", async (c) => {
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
  const provider = providerName ? getProvider("image", providerName) : getDefaultProvider("image");
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
generateRouter.post("/api/frames/select", async (c) => {
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

// GET /api/generate/providers — image providers for the image-gen UI.
generateRouter.get("/api/generate/providers", (c) => c.json(listProviders("image")));

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

generateRouter.post("/api/video/reframe", async (c) => {
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
  // #45 — the smart-crop Python scripts were deleted in the skill refactor
  // (commit 29b9e96, archived in tag pre-skill-rewrite-snapshot). Before this
  // guard the handler spawned a missing file and returned a bare 500 leaking an
  // absolute path; the frontend swallowed it and silently corrupted the work.
  // Fail fast with a structured, honest error the client can branch on instead.
  const { existsSync } = await import("node:fs");
  if (!existsSync(saliencyScript)) {
    return c.json(
      {
        error:
          "Reframe is unavailable on this build: the smart-crop scripts " +
          "(smart_crop/saliency.py, crop_9_16.py) were removed in the skill " +
          "refactor and have not been re-wired. The composition was NOT modified.",
        errorCode: "reframe_script_missing",
      },
      501,
    );
  }
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
//
// The generation dialog consumes { id, displayName, available, stub }. Since
// ADR-007 video is seedance-only (OpenRouter), this maps the unified registry's
// video listing to that shape. `stub: true` (no OPENROUTER_API_KEY) makes the
// dialog disable the option — #92's "dead dropdown" is now honest: one real
// provider, disabled until a key is present.
generateRouter.get("/api/providers", (c) => {
  const providers = listProviders("video").map((p) => {
    const adapter = getProvider("video", p.name);
    return {
      id: p.name,
      displayName: adapter?.displayName ?? p.name,
      available: p.available,
      stub: !p.available,
    };
  });
  return c.json({ providers });
});

// Phase 8.4 — provider dispatch
//
// Calls the provider adapter, then registers the resulting clip as a fresh
// AssetEntry + a "generate" ProvenanceEdge on the work's composition.yaml so
// the dive canvas / asset library pick it up immediately.
//
// fromAssetId is null because text-to-video has no source asset on disk.
generateRouter.post("/api/providers/:providerId/generate-video", async (c) => {
  const providerId = c.req.param("providerId");
  const body = await c.req.json<{
    workId: string;
    prompt: string;
    /** Optional — defaults to 4. */
    durationSec?: number;
    /** Optional — canvas-follow (comp.aspect → nearest supported ratio) when omitted. */
    aspectRatio?: string;
    /** R44 — image-to-video first-frame anchor. URL or data URI. Adapters
     *  that don't support i2v ignore this field and fall back to t2v. */
    firstFrameImage?: string;
    /** R44 — optional last-frame anchor for morph effects. */
    lastFrameImage?: string;
  }>();
  const provider = getProvider("video", providerId);
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
  const durationSec = body.durationSec ?? 4;

  // Explicit aspectRatio must be a supported ratio — the seedance enum has no
  // 4:5/auto, and a stale image-tab value (e.g. 4:5) carried into a video
  // dispatch would otherwise reach the gateway flat and silently fail.
  if (
    body.aspectRatio !== undefined &&
    !(SUPPORTED_VIDEO_ASPECT_RATIOS as readonly string[]).includes(body.aspectRatio)
  ) {
    return c.json({
      error: `aspectRatio must be one of ${SUPPORTED_VIDEO_ASPECT_RATIOS.join(", ")} (got ${body.aspectRatio})`,
    }, 400);
  }

  // Canvas-follow default (mirrors /api/generate/video): with no explicit
  // aspectRatio, follow the work's OWN composition aspect mapped onto the
  // nearest supported video ratio (4:5 → 3:4). No composition → don't send
  // anything (gateway default). This keeps the human-UI path and the agent
  // /api/generate/video path producing identical orientation.
  let aspectRatio = body.aspectRatio;
  if (!aspectRatio) {
    try {
      const comp = await readCompositionFor({ workId: body.workId });
      aspectRatio = closestSupportedRatio(comp.aspect);
    } catch {
      /* no composition — gateway default applies */
    }
  }

  const result = await provider.generateVideo({
    prompt: body.prompt,
    durationSec,
    ...(aspectRatio ? { aspectRatio } : {}),
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
  // works) we still return the adapter result so the UI can show it. Shared with
  // /api/generate/video so the AssetEntry/provenance shape is identical.
  const assetId = await registerGeneratedVideoAsset({
    workId: body.workId,
    relativeAssetUri,
    providerId,
    prompt: body.prompt,
    result,
    durationSec,
    extraParams: { ...(aspectRatio ? { aspectRatio } : {}), durationSec },
  });

  // I17 — broadcast asset-added so the library refreshes live. This is the
  // path the chat agent / generation dialog actually drive; same shape as the
  // image/video handlers above and audio.ts:279.
  uiEventBus.publish(body.workId, {
    type: "asset-added",
    workId: body.workId,
    ts: Date.now(),
    payload: { kind: "video", uri: relativeAssetUri, origin: "generate" },
  });

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

generateRouter.post("/api/post-process/:operation", async (c) => {
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

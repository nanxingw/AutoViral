import type { VideoProvider, VideoGenerateOptions, VideoGenerateResult } from "./types.js";
import { writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { FFMPEG_BIN } from "../../server/ffmpeg-paths.js";

/**
 * Re-encode an mp4 to be browser-friendly for the studio player.
 *
 * Two reasons this matters:
 *
 *   - Seedance 2.0 ships videos as a SINGLE GOP (one keyframe at t=0,
 *     then nothing). Browser h264 decoder LRU caches ~3s of decoded
 *     frames; once playback advances past that, the decoder evicts and
 *     has to re-decode from frame 0. The user sees a periodic ~3s
 *     stutter / "rewind". Forcing keyint=fps (≈1s GOP) gives the
 *     decoder anchor points to seek to without re-decoding everything.
 *
 *   - Seedance also ships moov atom AT THE END of the file, so the
 *     browser can't determine duration / index ranges without a HEAD-of-
 *     range fetch. -movflags +faststart relocates moov to the front so
 *     progressive playback starts immediately.
 *
 * Re-encode is fast (libx264 veryfast on 5s 720p ≈ 1-2s on Apple Silicon)
 * and crf 18 is visually transparent to the source quality. If the
 * re-encode fails for any reason (ffmpeg not installed, source corrupt)
 * we keep the original file rather than fail the whole job.
 */
async function normalizeVideoForBrowser(filePath: string, fps: number): Promise<void> {
  const tmpPath = `${filePath}.tmp.mp4`;
  await new Promise<void>((resolve, reject) => {
    const ff = spawn(
      FFMPEG_BIN,
      [
        "-y", "-loglevel", "error",
        "-i", filePath,
        // Force keyframe every fps frames (~1s GOP)
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-g", String(fps), "-keyint_min", String(fps),
        // Pass audio through if present
        "-c:a", "copy",
        // Move moov atom to start
        "-movflags", "+faststart",
        tmpPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    ff.stderr.on("data", (b: Buffer | string) => { stderr += b.toString(); });
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg normalize exit ${code}\n${stderr}`));
    });
    ff.on("error", reject);
  });
  await rename(tmpPath, filePath);
}

export const POLL_INTERVAL_MS = 5_000;
// ~15min. A real 4s/720p job was observed to finish just past the old 5min
// cap (2026-06-10 probe) — the enqueue is billed either way, so giving up
// early abandons a paid, still-running job with nothing to show for it.
export const MAX_POLL_ATTEMPTS = 180;

// Authoritative OpenRouter videos contract for bytedance/seedance-2.0, taken
// from GET /api/v1/videos/models (verified 2026-06-10). These back the route
// validation + canvas-follow mapping so the schema lives in one place.
export const SUPPORTED_VIDEO_ASPECT_RATIOS = [
  "1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21",
] as const;
export const SUPPORTED_VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
/** supported_durations: 4..15 integer seconds (no 3 — the old {3,5,10} teaching was wrong). */
export const SUPPORTED_VIDEO_DURATIONS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const;

const RATIO_VALUES: ReadonlyArray<readonly [string, number]> =
  SUPPORTED_VIDEO_ASPECT_RATIOS.map((label) => {
    const [w, h] = label.split(":").map(Number);
    return [label, w / h] as const;
  });

/**
 * Closest supported aspect-ratio label for a "W:H" string, by log distance, or
 * undefined when the input is malformed (gateway default then applies). Mirrors
 * openrouter-image.ts deriveAspectRatio. Anchors: 4:5 → 3:4, 9:16 → 9:16.
 */
export function closestSupportedRatio(aspect: string): string | undefined {
  const m = /^(\d+):(\d+)$/.exec(String(aspect).trim());
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h || w <= 0 || h <= 0) return undefined;
  const target = w / h;
  let best: string | undefined;
  let bestDist = Infinity;
  for (const [label, ratio] of RATIO_VALUES) {
    const dist = Math.abs(Math.log(target / ratio));
    if (dist < bestDist) {
      bestDist = dist;
      best = label;
    }
  }
  return best;
}

export interface SeedanceProviderOptions {
  /** Override OpenRouter base URL (for testing). */
  baseUrl?: string;
  /** Output directory for the downloaded mp4. Required for production use. */
  outputDir?: string;
}

interface EnqueueResponse {
  id: string;
  polling_url: string;
  status: string;
}

interface PollResponse {
  id?: string;
  status: string;
  unsigned_urls?: string[];
  usage?: { cost?: number; is_byok?: boolean };
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

/**
 * Seedance 2.0 video provider via OpenRouter.
 *
 * Async-job API:
 *   1. POST /videos -> { id, polling_url, status: "pending" }
 *   2. GET polling_url every 5s until status === "completed" or "failed"
 *   3. GET unsigned_urls[0] (with same auth header) -> mp4 bytes
 *
 * Falls back to stub when OPENROUTER_API_KEY is not set.
 *
 * Root cause confirmed 2026-06-10: the request schema is FLAT —
 * model / prompt / duration / aspect_ratio / resolution / generate_audio /
 * frame_images are all top-level fields (verified against the official
 * create-videos doc + GET /api/v1/videos/models). The previous code wrapped
 * everything in `input: {}`, which the gateway silently DROPPED — so portrait
 * requests came back 16:9 and i2v "never took": the parameters never arrived.
 * The fix sends them flat; i2v frame entries follow the schema shape
 * { type: "image_url", image_url: { url }, frame_type: "first_frame" | "last_frame" }.
 *
 * Empirically verified via paid probes (2026-06-10, ffprobe-confirmed):
 *   - t2v aspect_ratio "16:9" @720p → 1280×720 landscape ($0.60/4s)
 *   - t2v "9:16" @1080p → 1080×1920 ($1.36/4s) — 1080p is real, not doc fiction
 *   - i2v with a 9:16 input image + explicit "16:9" → 1280×720: the CALLER's
 *     aspect wins over the input image's own ratio (no crop-to-input lock)
 *   - all outputs 24fps; ByteDance REJECTS i2v input images that look like a
 *     real person (InputImageSensitiveContentDetected.PrivacyInformation, 400
 *     at enqueue, not billed)
 */
export function createSeedanceProvider(opts: SeedanceProviderOptions = {}): VideoProvider {
  const baseUrl = opts.baseUrl ?? "https://openrouter.ai/api/v1";
  return {
    id: "seedance",
    displayName: "Seedance 2.0 (via OpenRouter)",
    async generateVideo(req: VideoGenerateOptions): Promise<VideoGenerateResult> {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        // Stub mode: no API key.
        const hash = hashPrompt(req.prompt);
        return {
          assetUri: `assets/stub-videos/seedance-${hash}.mp4`,
          stub: true,
          costUsd: 0,
        };
      }

      // 1) Enqueue
      // R44 — image-to-video. When firstFrameImage / lastFrameImage are
      // present, OpenRouter Seedance accepts a top-level `frame_images` array
      // with entries shaped { type: "image_url", image_url: { url }, frame_type }
      // where frame_type ∈ { "first_frame", "last_frame" }. Without these the
      // call falls back to pure text-to-video.
      const frameImages: Array<{
        type: "image_url";
        image_url: { url: string };
        frame_type: "first_frame" | "last_frame";
      }> = [];
      if (req.firstFrameImage) {
        frameImages.push({
          type: "image_url",
          image_url: { url: req.firstFrameImage },
          frame_type: "first_frame",
        });
      }
      if (req.lastFrameImage) {
        frameImages.push({
          type: "image_url",
          image_url: { url: req.lastFrameImage },
          frame_type: "last_frame",
        });
      }
      const enqueueRes = await fetch(`${baseUrl}/videos`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        // FLAT payload — the OpenRouter videos schema has no `input` wrapper;
        // nesting silently dropped every param. Only send optional fields when
        // the caller set them so the gateway default applies otherwise.
        body: JSON.stringify({
          model: "bytedance/seedance-2.0",
          prompt: req.prompt,
          duration: req.durationSec,
          ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
          ...(req.resolution ? { resolution: req.resolution } : {}),
          ...(req.generateAudio !== undefined
            ? { generate_audio: req.generateAudio }
            : {}),
          ...(frameImages.length > 0 ? { frame_images: frameImages } : {}),
        }),
      });
      if (!enqueueRes.ok) {
        const body = await enqueueRes.text();
        throw new Error(`Seedance enqueue failed: ${enqueueRes.status} ${body}`);
      }
      const job = (await enqueueRes.json()) as EnqueueResponse;

      // 2) Poll
      let final: PollResponse | null = null;
      for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const pollRes = await fetch(job.polling_url, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!pollRes.ok) continue;
        const status = (await pollRes.json()) as PollResponse;
        if (status.status === "completed") {
          final = status;
          break;
        }
        if (status.status === "failed") {
          throw new Error(`Seedance job ${job.id} failed: ${JSON.stringify(status)}`);
        }
      }
      if (!final) {
        throw new Error(
          `Seedance job ${job.id} timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS}ms`,
        );
      }
      const url = final.unsigned_urls?.[0];
      if (!url) {
        throw new Error(`Seedance job ${job.id} completed but no unsigned_urls`);
      }

      // 3) Download mp4
      const dlRes = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!dlRes.ok) {
        throw new Error(`Seedance download failed: ${dlRes.status}`);
      }
      const buf = Buffer.from(await dlRes.arrayBuffer());
      const hash = hashPrompt(req.prompt);
      const filename = `seedance-${hash}.mp4`;
      // Per-request outputAbsoluteDir wins; falls back to construct-time
      // outputDir for the test harness; if neither, return the relative path
      // without writing (lets unit tests run without disk side effects).
      const targetDir = req.outputAbsoluteDir ?? opts.outputDir;
      const assetUri = targetDir
        ? `${targetDir}/${filename}`
        : `assets/seedance/${filename}`;
      if (targetDir) {
        await mkdir(targetDir, { recursive: true });
        await writeFile(assetUri, buf);
        // Normalize: short GOP + faststart. Seedance ships single-GOP
        // mp4s that stutter every ~3s in the studio player as the
        // browser decoder evicts. Best-effort — preserve the raw file
        // on any failure.
        try {
          // Seedance output is a fixed 24fps stream regardless of input
          // params; using 24 here matches and gives a 1s keyframe
          // interval (24 frames per GOP).
          await normalizeVideoForBrowser(assetUri, 24);
        } catch (err) {
          console.warn(
            `[seedance] mp4 normalize failed (keeping raw): ${(err as Error).message}`,
          );
          // Clean up any orphaned temp file from a partial ffmpeg run.
          try { await unlink(`${assetUri}.tmp.mp4`); } catch { /* ignore */ }
        }
      }
      return {
        assetUri,
        providerJobId: job.id,
        costUsd: final.usage?.cost ?? 0,
        stub: false,
      };
    },
  };
}

export const seedanceProvider = createSeedanceProvider();

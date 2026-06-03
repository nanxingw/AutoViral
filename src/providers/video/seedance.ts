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

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 60; // ~5min total

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
 * KNOWN ISSUE: aspect_ratio field shape is unverified. We pass through
 * whatever the caller requests as `input.aspect_ratio` (e.g. "9:16"),
 * but empirically the API has been observed to return 16:9 output for
 * portrait requests. Users should iterate the prompt/parameters until
 * the API contract for orientation is confirmed.
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
      // present, OpenRouter Seedance accepts a `frame_images` array under
      // `input` with entries like { frame_type: "first" | "last", image }.
      // Without these the call falls back to pure text-to-video, which is
      // the original Phase-2 behaviour — preserved untouched.
      const frameImages: Array<{ frame_type: "first" | "last"; image: string }> = [];
      if (req.firstFrameImage) {
        frameImages.push({ frame_type: "first", image: req.firstFrameImage });
      }
      if (req.lastFrameImage) {
        frameImages.push({ frame_type: "last", image: req.lastFrameImage });
      }
      const enqueueRes = await fetch(`${baseUrl}/videos`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "bytedance/seedance-2.0",
          prompt: req.prompt,
          input: {
            duration: req.durationSec,
            aspect_ratio: req.aspectRatio,
            // Only include frame_images when at least one anchor is set —
            // sending an empty array could be interpreted as "no frames"
            // and 400 the request on stricter API versions.
            ...(frameImages.length > 0 ? { frame_images: frameImages } : {}),
          },
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

import type { VideoProvider, VideoGenerateOptions, VideoGenerateResult } from "./types.js";
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

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

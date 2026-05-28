// src/server/audio/peaks-backfill.ts
//
// On server boot, scan all works/* for audio assets without a sibling
// `.peaks.json` and generate them in the background. Fire-and-forget —
// failures are warnings, never block startup.
//
// Throttle (#29): 1 concurrent ffmpeg job + a short breath between jobs. The
// backfill is non-urgent (the frontend falls back to on-the-fly WebAudio
// decode for any asset still missing peaks — #30), so we keep it GENTLE rather
// than fast: a first boot after this lands shouldn't peg every core / spin the
// fans. The AC explicitly calls for "1 concurrent, 100ms breath".

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { generatePeaks, isAudioAsset } from "./peaks.js";

const DEFAULT_CONCURRENCY = 1;
const DEFAULT_BREATH_MS = 100;

export interface BackfillOptions {
  /** Max concurrent generate jobs. Default 1 (gentle background pass). */
  concurrency?: number;
  /** Pause after each job so we don't saturate the CPU. Default 100ms. */
  breathMs?: number;
  /** Injectable for tests — defaults to the real ffmpeg-backed generatePeaks. */
  generate?: (srcPath: string) => Promise<unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function listAudioFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // dir may not exist for some works
    }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        // Don't recurse into output/ — we never want to compute peaks for
        // rendered final-*.mp4 (they're video) or for nested asset caches.
        if (ent.name === "output") continue;
        await walk(p);
      } else if (ent.isFile() && isAudioAsset(p)) {
        out.push(p);
      }
    }
  }
  await walk(rootDir);
  return out;
}

async function runWithLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        await fn(items[i]);
      } catch (err) {
        console.warn(
          `[peaks-backfill] ${items[i]} failed: ${(err as Error).message}`,
        );
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
}

/**
 * Walk worksRoot/<workId>/assets/, generate missing peaks.json files.
 * Idempotent — generatePeaks skips files that already have an up-to-date
 * peaks sibling.
 */
export async function backfillPeaks(
  worksRoot: string,
  opts: BackfillOptions = {},
): Promise<void> {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const breathMs = opts.breathMs ?? DEFAULT_BREATH_MS;
  const generate = opts.generate ?? generatePeaks;

  let workIds: string[];
  try {
    const entries = await readdir(worksRoot, { withFileTypes: true });
    workIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return; // no works dir yet — first run
  }

  const allAudio: string[] = [];
  for (const id of workIds) {
    const assetsDir = join(worksRoot, id, "assets");
    try {
      await stat(assetsDir);
    } catch {
      continue;
    }
    allAudio.push(...(await listAudioFiles(assetsDir)));
  }

  if (allAudio.length === 0) return;

  const t0 = Date.now();
  let generated = 0;
  await runWithLimit(allAudio, concurrency, async (file) => {
    const before = Date.now();
    await generate(file);
    // We can't tell from the return value whether work was actually done
    // (idempotent skip vs fresh compute); peek at elapsed.
    if (Date.now() - before > 50) generated++;
    if (breathMs > 0) await sleep(breathMs); // gentle pacing (#29)
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[peaks-backfill] scanned ${allAudio.length} audio files, generated ${generated} new (${elapsed}s)`,
  );
}

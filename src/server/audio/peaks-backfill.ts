// src/server/audio/peaks-backfill.ts
//
// On server boot, scan all works/* for audio assets without a sibling
// `.peaks.json` and generate them in the background. Fire-and-forget —
// failures are warnings, never block startup.
//
// Run-time bound: max 4 concurrent ffmpeg processes so a large
// catalogue doesn't peg every CPU core during boot.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { generatePeaks, isAudioAsset } from "./peaks.js";

const CONCURRENCY = 4;

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
export async function backfillPeaks(worksRoot: string): Promise<void> {
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
  await runWithLimit(allAudio, CONCURRENCY, async (file) => {
    const before = Date.now();
    await generatePeaks(file);
    // We can't tell from the return value whether work was actually done
    // (idempotent skip vs fresh compute); peek at elapsed.
    if (Date.now() - before > 50) generated++;
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[peaks-backfill] scanned ${allAudio.length} audio files, generated ${generated} new (${elapsed}s)`,
  );
}

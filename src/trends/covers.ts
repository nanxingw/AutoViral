import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export function sanitizeCoverId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

export function coversDir(platform: string): string {
  return join(homedir(), ".autoviral", "trends", platform, "covers");
}

// Per-cover wall-clock cap. Many trending items reference CDNs that may be
// hotlink-blocked, geo-restricted, or unreachable from the server's network
// (e.g. i.ytimg.com via PRC proxy). Without an explicit AbortSignal, fetch
// waits for the OS TCP timeout (~75s on macOS) per item, blowing past the
// pipeline's overall budget. 5s is generous for reachable CDNs and bounds
// the failure cost for unreachable ones.
const COVER_FETCH_TIMEOUT_MS = 5000;

export async function downloadCover(
  url: string,
  dir: string,
  rawId: string,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), COVER_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dir, { recursive: true });
    const filename = `${sanitizeCoverId(rawId)}.jpg`;
    const path = join(dir, filename);
    await writeFile(path, buf);
    return path;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function gcOldCovers(dir: string, keepMax: number): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const stats = await Promise.all(
    entries.map(async (name) => ({ name, mtime: (await stat(join(dir, name))).mtimeMs })),
  );
  stats.sort((a, b) => b.mtime - a.mtime); // newest first
  for (const old of stats.slice(keepMax)) {
    await unlink(join(dir, old.name)).catch(() => {});
  }
}

import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export function sanitizeCoverId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

export function coversDir(platform: string): string {
  return join(homedir(), ".autoviral", "trends", platform, "covers");
}

export async function downloadCover(
  url: string,
  dir: string,
  rawId: string,
): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dir, { recursive: true });
    const filename = `${sanitizeCoverId(rawId)}.jpg`;
    const path = join(dir, filename);
    await writeFile(path, buf);
    return path;
  } catch {
    return null;
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

import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./config.js";

const SHARED_DIR = path.join(dataDir, "shared-assets");
const CATEGORIES = ["characters", "scenes", "music", "templates", "branding", "general"] as const;
type Category = (typeof CATEGORIES)[number];

export interface AssetFile {
  name: string;
  size: number;
  mtime: string;
  category: string;
}

export function sanitizeFilename(name: string): string {
  const clean = path.basename(name).replace(/[\x00]/g, "");
  if (!clean || clean === "." || clean === "..") {
    throw new Error("Invalid filename");
  }
  return clean;
}

export function validateCategory(category: string): asserts category is Category {
  if (!CATEGORIES.includes(category as Category)) {
    throw new Error(`Invalid category: ${category}`);
  }
}

export function getSharedAssetPath(category: string, filename: string): string {
  validateCategory(category);
  const safe = sanitizeFilename(filename);
  const resolved = path.resolve(SHARED_DIR, category, safe);
  if (!resolved.startsWith(path.resolve(SHARED_DIR))) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

export async function ensureSharedDirs() {
  for (const cat of CATEGORIES) {
    await fs.mkdir(path.join(SHARED_DIR, cat), { recursive: true });
  }
}

export async function listSharedAssetsWithMeta(): Promise<Record<string, AssetFile[]>> {
  const result: Record<string, AssetFile[]> = {};
  for (const cat of CATEGORIES) {
    const dir = path.join(SHARED_DIR, cat);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files: AssetFile[] = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        try {
          const stat = await fs.stat(path.join(dir, entry.name));
          files.push({ name: entry.name, size: stat.size, mtime: stat.mtime.toISOString(), category: cat });
        } catch { /* skip unreadable files */ }
      }
      files.sort((a, b) => b.mtime.localeCompare(a.mtime));
      result[cat] = files;
    } catch {
      result[cat] = [];
    }
  }
  return result;
}

export async function listSharedAssets(): Promise<Record<string, string[]>> {
  const meta = await listSharedAssetsWithMeta();
  const result: Record<string, string[]> = {};
  for (const [cat, files] of Object.entries(meta)) {
    result[cat] = files.map((f) => f.name);
  }
  return result;
}

export async function saveSharedAsset(category: string, filename: string, data: Buffer | Uint8Array): Promise<AssetFile> {
  const filePath = getSharedAssetPath(category, filename);
  await fs.writeFile(filePath, data);
  const stat = await fs.stat(filePath);
  return { name: sanitizeFilename(filename), size: stat.size, mtime: stat.mtime.toISOString(), category };
}

export async function deleteSharedAsset(category: string, filename: string): Promise<void> {
  const filePath = getSharedAssetPath(category, filename);
  await fs.unlink(filePath);
}

export async function moveSharedAsset(fromCat: string, toCat: string, filename: string): Promise<void> {
  const src = getSharedAssetPath(fromCat, filename);
  const dst = getSharedAssetPath(toCat, filename);
  try {
    await fs.access(dst);
    throw new Error("File already exists at destination");
  } catch (e: any) {
    if (e.message === "File already exists at destination") throw e;
  }
  await fs.rename(src, dst);
}

export { CATEGORIES, SHARED_DIR };

import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from './config.js';
const SHARED_DIR = path.join(dataDir, 'shared-assets');
const CATEGORIES = ['characters', 'music', 'templates'];
export async function ensureSharedDirs() {
    for (const cat of CATEGORIES) {
        await fs.mkdir(path.join(SHARED_DIR, cat), { recursive: true });
    }
}
export async function listSharedAssets() {
    const result = {};
    for (const cat of CATEGORIES) {
        const dir = path.join(SHARED_DIR, cat);
        try {
            result[cat] = await fs.readdir(dir);
        }
        catch {
            result[cat] = [];
        }
    }
    return result;
}
export function getSharedAssetPath(category, filename) {
    return path.join(SHARED_DIR, category, filename);
}
export { CATEGORIES };
//# sourceMappingURL=shared-assets.js.map
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import yaml from "js-yaml";
import dotenv from "dotenv";

dotenv.config();

export interface Config {
  port: number;
  model: string;
  openrouter?: { apiKey: string };
  // #60 — jimeng (火山引擎/即梦) cloud credentials. Present in real on-disk
  // configs but was never declared here, so the GET /api/config redaction
  // sweep couldn't "see" it and leaked accessKey/secretKey in plaintext via
  // the untyped `...config` spread. Declaring it makes the secret path typed
  // and enumerable by SECRET_PATHS (src/server/api.ts).
  jimeng?: { accessKey?: string; secretKey?: string };
  research: { enabled: boolean; schedule: string; platforms: string[] };
  interests?: string[];
  memory?: { apiKey: string; userId: string; syncEnabled: boolean };
  analytics?: {
    douyinUrl: string;
    collectInterval: number;
    enabled: boolean;
  };
}

const CONFIG_DIR = join(homedir(), ".autoviral");
const CONFIG_PATH = join(CONFIG_DIR, "config.yaml");

/** Base data directory for works, trends, etc.
 *  Tests can override via AUTOVIRAL_DATA_DIR; resolved at module load. */
export const dataDir = process.env.AUTOVIRAL_DATA_DIR ?? CONFIG_DIR;

/** Repo root directory — used by the rubric reader and any code that needs
 *  to load files shipped with the package. Resolves to the parent of the
 *  directory containing this module (src/ in dev, dist/ in prod). */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function getDefaultConfig(): Config {
  return {
    port: 3271,
    model: "opus",
    // e2e-report F139: minute :07 not :00. Multi-tenant CLI installs all
    // firing on the exact same wall-clock minute look like coordinated
    // scraping to small-red-book / douyin anti-bot heuristics. Offsetting
    // minute (07 chosen arbitrarily but stable, not random — easier debug)
    // breaks the synchronisation without changing the twice-daily cadence.
    research: { enabled: true, schedule: "7 9,21 * * *", platforms: ["douyin", "xiaohongshu"] },
    interests: [],
    analytics: { douyinUrl: "", collectInterval: 60, enabled: true },
  };
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function loadConfig(): Promise<Config> {
  await ensureDir(CONFIG_DIR);
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = yaml.load(raw) as Partial<Config> | null;
    const config: Config = { ...getDefaultConfig(), ...parsed };
    config.interests = config.interests ?? [];

    // .env overrides
    if (process.env.OPENROUTER_API_KEY) {
      config.openrouter = { apiKey: process.env.OPENROUTER_API_KEY };
    }
    if (process.env.EVERMEMOS_API_KEY) {
      if (!config.memory) {
        config.memory = { apiKey: "", userId: "autoviral-user", syncEnabled: false };
      }
      config.memory.apiKey = process.env.EVERMEMOS_API_KEY;
    }

    return config;
  } catch {
    const config = getDefaultConfig();
    await saveConfig(config);
    return config;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureDir(CONFIG_DIR);
  const raw = yaml.dump(config, { lineWidth: -1 });
  await writeFile(CONFIG_PATH, raw, "utf-8");
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

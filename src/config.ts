import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import dotenv from "dotenv";

dotenv.config();

export interface Config {
  port: number;
  model: string;
  jimeng: { accessKey: string; secretKey: string };
  openrouter?: { apiKey: string };
  research: { enabled: boolean; schedule: string; platforms: string[] };
  memory?: { apiKey: string; userId: string };
}

const CONFIG_DIR = join(homedir(), ".skill-evolver");
const CONFIG_PATH = join(CONFIG_DIR, "config.yaml");

/** Base data directory for works, trends, etc. */
export const dataDir = CONFIG_DIR;

export function getDefaultConfig(): Config {
  return {
    port: 3271,
    model: "opus",
    jimeng: { accessKey: "", secretKey: "" },
    research: { enabled: true, schedule: "0 9,21 * * *", platforms: ["douyin", "xiaohongshu"] },
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

    // .env overrides
    if (process.env.OPENROUTER_API_KEY) {
      config.openrouter = { apiKey: process.env.OPENROUTER_API_KEY };
    }
    if (process.env.EVERMEMOS_API_KEY && config.memory) {
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

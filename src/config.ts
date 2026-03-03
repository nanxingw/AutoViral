import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";

export interface Config {
  interval: string;
  model: string;
  autoRun: boolean;
  port: number;
  maxReports: number;
  reportsToFeed: number;
}

const CONFIG_DIR = join(homedir(), ".skill-evolver");
const CONFIG_PATH = join(CONFIG_DIR, "config.yaml");

export function getDefaultConfig(): Config {
  return {
    interval: "1h",
    model: "sonnet",
    autoRun: true,
    port: 3271,
    maxReports: 50,
    reportsToFeed: 5,
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
    return { ...getDefaultConfig(), ...parsed };
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

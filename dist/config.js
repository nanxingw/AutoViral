import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import dotenv from "dotenv";
dotenv.config();
const CONFIG_DIR = join(homedir(), ".autoviral");
const CONFIG_PATH = join(CONFIG_DIR, "config.yaml");
/** Base data directory for works, trends, etc. */
export const dataDir = CONFIG_DIR;
export function getDefaultConfig() {
    return {
        port: 3271,
        model: "opus",
        jimeng: { accessKey: "", secretKey: "" },
        research: { enabled: true, schedule: "0 9,21 * * *", platforms: ["douyin", "xiaohongshu"] },
        interests: [],
        analytics: { douyinUrl: "", collectInterval: 60, enabled: true },
    };
}
export async function ensureDir(dirPath) {
    await mkdir(dirPath, { recursive: true });
}
export async function loadConfig() {
    await ensureDir(CONFIG_DIR);
    try {
        const raw = await readFile(CONFIG_PATH, "utf-8");
        const parsed = yaml.load(raw);
        const config = { ...getDefaultConfig(), ...parsed };
        config.interests = config.interests ?? [];
        // .env overrides
        if (process.env.JIMENG_ACCESS_KEY) {
            config.jimeng.accessKey = process.env.JIMENG_ACCESS_KEY;
        }
        if (process.env.JIMENG_SECRET_KEY) {
            config.jimeng.secretKey = process.env.JIMENG_SECRET_KEY;
        }
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
    }
    catch {
        const config = getDefaultConfig();
        await saveConfig(config);
        return config;
    }
}
export async function saveConfig(config) {
    await ensureDir(CONFIG_DIR);
    const raw = yaml.dump(config, { lineWidth: -1 });
    await writeFile(CONFIG_PATH, raw, "utf-8");
}
export function getConfigDir() {
    return CONFIG_DIR;
}
//# sourceMappingURL=config.js.map
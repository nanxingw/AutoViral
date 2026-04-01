import cron from "node-cron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "./config.js";
const execFileAsync = promisify(execFile);
const ANALYTICS_DIR = join(homedir(), ".autoviral", "analytics", "douyin");
const LATEST_FILE = join(ANALYTICS_DIR, "latest.json");
let task = null;
async function collectData(douyinUrl) {
    const scriptPath = join(homedir(), ".claude", "skills", "creator-analytics", "scripts", "collect.py");
    try {
        await mkdir(ANALYTICS_DIR, { recursive: true });
        const { stdout } = await execFileAsync("python3", [
            scriptPath, "--platform", "douyin", "--url", douyinUrl
        ], { timeout: 120000 });
        const data = JSON.parse(stdout.trim());
        await writeFile(LATEST_FILE, JSON.stringify(data, null, 2), "utf-8");
        const dateStr = new Date().toISOString().slice(0, 10);
        await writeFile(join(ANALYTICS_DIR, `${dateStr}.json`), JSON.stringify(data, null, 2), "utf-8");
        console.log(`[analytics] Collected data for ${data.account?.nickname ?? "unknown"}: ${data.summary?.total_works_collected ?? 0} works`);
        return data;
    }
    catch (err) {
        console.error("[analytics] Collection failed:", err instanceof Error ? err.message : err);
        return null;
    }
}
export async function getLatestCreatorData() {
    try {
        const raw = await readFile(LATEST_FILE, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function getCreatorHistory(days = 30) {
    try {
        const files = await readdir(ANALYTICS_DIR);
        const jsonFiles = files.filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(0, days);
        const results = [];
        for (const f of jsonFiles) {
            try {
                const raw = await readFile(join(ANALYTICS_DIR, f), "utf-8");
                results.push({ date: f.replace(".json", ""), data: JSON.parse(raw) });
            }
            catch { /* skip */ }
        }
        return results;
    }
    catch {
        return [];
    }
}
export async function startAnalyticsCollector() {
    const config = await loadConfig();
    const analytics = config.analytics;
    if (!analytics?.enabled || !analytics?.douyinUrl) {
        console.log("[analytics] Disabled or no URL configured, skipping");
        return;
    }
    collectData(analytics.douyinUrl).catch(() => { });
    const intervalMinutes = analytics.collectInterval || 60;
    const cronExpr = `*/${intervalMinutes} * * * *`;
    task = cron.schedule(cronExpr, () => {
        loadConfig().then(cfg => {
            if (cfg.analytics?.douyinUrl)
                collectData(cfg.analytics.douyinUrl).catch(() => { });
        });
    });
    console.log(`[analytics] Scheduled every ${intervalMinutes} minutes for ${analytics.douyinUrl}`);
}
export function stopAnalyticsCollector() {
    task?.stop();
    task = null;
}
//# sourceMappingURL=analytics-collector.js.map
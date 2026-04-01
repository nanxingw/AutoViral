/**
 * Structured logging service for AutoViral.
 *
 * Writes JSON-line logs to ~/.autoviral/logs/ with daily rotation.
 * Each log entry has: timestamp, level, source, event, data.
 *
 * Sources: ws-bridge, api, analytics, memory-sync, cli
 * Levels: debug, info, warn, error
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
const LOG_DIR = join(homedir(), ".autoviral", "logs");
let initialized = false;
async function ensureLogDir() {
    if (initialized)
        return;
    await mkdir(LOG_DIR, { recursive: true });
    initialized = true;
}
function getLogFilePath() {
    const date = new Date().toISOString().slice(0, 10);
    return join(LOG_DIR, `${date}.jsonl`);
}
async function writeLog(entry) {
    try {
        await ensureLogDir();
        const line = JSON.stringify(entry) + "\n";
        await appendFile(getLogFilePath(), line, "utf-8");
    }
    catch {
        // Logging should never crash the app
    }
}
/**
 * Log a structured event.
 */
export function log(level, source, event, workId, data) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        source,
        event,
        ...(workId ? { workId } : {}),
        ...(data ? { data } : {}),
    };
    // Also print to console for real-time visibility
    const prefix = `[${source}]`;
    if (level === "error") {
        console.error(prefix, event, data ? JSON.stringify(data).slice(0, 200) : "");
    }
    else if (level === "warn") {
        console.warn(prefix, event, data ? JSON.stringify(data).slice(0, 200) : "");
    }
    else if (level === "debug") {
        // Debug only goes to file, not console
    }
    else {
        console.log(prefix, event);
    }
    // Write to file (fire and forget)
    writeLog(entry).catch(() => { });
}
/**
 * Log WsBridge events — the most important logging for debugging agent interactions.
 */
export function logBridge(event, workId, data) {
    log("info", "ws-bridge", event, workId, data);
}
/**
 * Log WsBridge debug events (tool calls, text chunks, etc.)
 */
export function logBridgeDebug(event, workId, data) {
    log("debug", "ws-bridge", event, workId, data);
}
/**
 * Read log entries for a specific work or date range.
 * Used by the log viewer API.
 */
export async function readLogs(options) {
    const { readFile, readdir } = await import("node:fs/promises");
    const limit = options.limit ?? 500;
    try {
        await ensureLogDir();
        let files;
        if (options.date) {
            files = [`${options.date}.jsonl`];
        }
        else {
            const allFiles = await readdir(LOG_DIR);
            files = allFiles.filter(f => f.endsWith(".jsonl")).sort().reverse().slice(0, 7); // Last 7 days
        }
        const entries = [];
        for (const file of files) {
            try {
                const raw = await readFile(join(LOG_DIR, file), "utf-8");
                const lines = raw.trim().split("\n").filter(Boolean);
                for (const line of lines) {
                    try {
                        const entry = JSON.parse(line);
                        if (options.workId && entry.workId !== options.workId)
                            continue;
                        if (options.source && entry.source !== options.source)
                            continue;
                        if (options.level && entry.level !== options.level)
                            continue;
                        entries.push(entry);
                    }
                    catch { /* skip malformed lines */ }
                }
            }
            catch { /* skip missing files */ }
        }
        // Return most recent entries first, limited
        return entries.reverse().slice(0, limit);
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=logger.js.map
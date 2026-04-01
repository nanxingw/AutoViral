/**
 * Structured logging service for AutoViral.
 *
 * Writes JSON-line logs to ~/.autoviral/logs/ with daily rotation.
 * Each log entry has: timestamp, level, source, event, data.
 *
 * Sources: ws-bridge, api, analytics, memory-sync, cli
 * Levels: debug, info, warn, error
 */
type LogLevel = "debug" | "info" | "warn" | "error";
type LogSource = "ws-bridge" | "api" | "analytics" | "memory-sync" | "cli" | "server" | "studio";
interface LogEntry {
    ts: string;
    level: LogLevel;
    source: LogSource;
    event: string;
    workId?: string;
    data?: Record<string, unknown>;
}
/**
 * Log a structured event.
 */
export declare function log(level: LogLevel, source: LogSource, event: string, workId?: string, data?: Record<string, unknown>): void;
/**
 * Log WsBridge events — the most important logging for debugging agent interactions.
 */
export declare function logBridge(event: string, workId: string, data?: Record<string, unknown>): void;
/**
 * Log WsBridge debug events (tool calls, text chunks, etc.)
 */
export declare function logBridgeDebug(event: string, workId: string, data?: Record<string, unknown>): void;
/**
 * Read log entries for a specific work or date range.
 * Used by the log viewer API.
 */
export declare function readLogs(options: {
    date?: string;
    workId?: string;
    source?: LogSource;
    level?: LogLevel;
    limit?: number;
}): Promise<LogEntry[]>;
export {};
//# sourceMappingURL=logger.d.ts.map
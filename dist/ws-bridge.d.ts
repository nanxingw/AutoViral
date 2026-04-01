/**
 * WsBridge — Agent Session Manager
 *
 * Bridges browser ↔ server ↔ Claude CLI via stdout pipe.
 * Each "work" gets a WsSession with CLI process, browser connections,
 * message history. CLI is spawned with `-p <prompt> --output-format stream-json
 * --verbose`. Multi-turn uses `--resume <sessionId> -p <newMessage>`.
 *
 * Browser clients connect to /ws/browser/:workId for live streaming.
 */
import { type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
export interface ChatBlock {
    type: "user" | "text" | "thinking" | "tool_use" | "tool_result" | "step_divider";
    text: string;
    toolName?: string;
    collapsed?: boolean;
    timestamp?: string;
}
export interface WsSession {
    workId: string;
    cliSessionId?: string;
    browserSockets: Set<WebSocket>;
    cliProcess?: ChildProcess;
    idle: boolean;
    messageHistory: ChatBlock[];
    model?: string;
}
export declare class WsBridge {
    private sessions;
    private eventListeners;
    private browserWss;
    constructor(_serverPort: number);
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
    ensureSession(workId: string): WsSession;
    /**
     * Build a system prompt with full context for a given work.
     */
    private buildSystemPrompt;
    /**
     * Start a new CLI session. Loads work context, builds system prompt,
     * then spawns `claude -p <prompt> --output-format stream-json --verbose`.
     */
    createSession(workId: string, initialPrompt: string, model?: string): Promise<WsSession>;
    /**
     * Create an ephemeral trend research session.
     * Uses sonnet model, auto-kills after 180s, filters CLI events into simplified research events.
     */
    createTrendSession(sessionKey: string, prompt: string): Promise<WsSession>;
    /**
     * Send a follow-up message using --resume + new -p.
     * Kills current CLI (if busy) and spawns a new one that resumes the session.
     */
    sendMessage(workId: string, text: string): Promise<boolean>;
    killSession(workId: string): boolean;
    killTrendSession(sessionKey: string): boolean;
    getSession(workId: string): WsSession | undefined;
    /**
     * Register a listener for session events. Returns cleanup function.
     * Used by TestRunner to wait for events without polling.
     */
    onSessionEvent(workId: string, callback: (event: string, data: unknown) => void): () => void;
    getAllSessions(): Map<string, WsSession>;
    /**
     * After trend session completes, read the agent-written data.json and
     * copy it to the dated YAML cache so GET /api/trends/:platform picks it up.
     * Also read report.md and broadcast it to the frontend.
     */
    private finalizeTrendData;
    private cleanupTrendSession;
    private spawnCli;
    private handleBrowserConnection;
    private broadcastToBrowsers;
    private extractWorkId;
}
//# sourceMappingURL=ws-bridge.d.ts.map
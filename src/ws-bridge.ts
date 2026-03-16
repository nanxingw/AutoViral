/**
 * WsBridge — Agent Session Manager
 *
 * Bridges browser ↔ server ↔ Claude CLI via WebSocket.
 * Each "work" gets a WsSession that holds the CLI process, browser connections,
 * message history, and pending messages.
 *
 * The CLI connects back to us via --sdk-url (NDJSON over WebSocket).
 * Browser clients connect to /ws/browser/:workId for live streaming.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface WsSession {
  workId: string;
  cliSessionId?: string;
  cliSocket?: WebSocket;
  browserSockets: Set<WebSocket>;
  cliProcess?: ChildProcess;
  idle: boolean;
  messageHistory: HistoryEntry[];
  pendingMessages: string[];
  model?: string;
}

interface NdjsonMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  content?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

// ── WsBridge ─────────────────────────────────────────────────────────────────

export class WsBridge {
  private sessions: Map<string, WsSession> = new Map();
  private cliWss: WebSocketServer;
  private browserWss: WebSocketServer;
  private serverPort: number;

  constructor(serverPort: number) {
    this.serverPort = serverPort;

    // Both use noServer mode — we manually handle upgrades
    this.cliWss = new WebSocketServer({ noServer: true });
    this.browserWss = new WebSocketServer({ noServer: true });

    this.cliWss.on("connection", (ws, req) => {
      const workId = this.extractWorkId(req.url ?? "", "cli");
      if (workId) this.handleCliConnection(workId, ws);
    });

    this.browserWss.on("connection", (ws, req) => {
      const workId = this.extractWorkId(req.url ?? "", "browser");
      if (workId) this.handleBrowserConnection(workId, ws);
    });
  }

  // ── Upgrade handler ──────────────────────────────────────────────────────

  /**
   * Handle HTTP upgrade requests. Returns true if the request was handled
   * (matched /ws/cli/:workId or /ws/browser/:workId), false otherwise.
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = req.url ?? "";

    if (url.match(/^\/ws\/cli\/[^/]+/)) {
      this.cliWss.handleUpgrade(req, socket, head, (ws) => {
        this.cliWss.emit("connection", ws, req);
      });
      return true;
    }

    if (url.match(/^\/ws\/browser\/[^/]+/)) {
      this.browserWss.handleUpgrade(req, socket, head, (ws) => {
        this.browserWss.emit("connection", ws, req);
      });
      return true;
    }

    return false;
  }

  // ── Session management ───────────────────────────────────────────────────

  /**
   * Create a new CLI session for a work. Spawns Claude CLI with --sdk-url
   * pointing back to our server. The initial prompt is queued as a pending
   * message and flushed when the CLI connects and sends system.init.
   */
  createSession(workId: string, initialPrompt: string, model?: string): WsSession {
    // Kill existing session if any
    const existing = this.sessions.get(workId);
    if (existing?.cliProcess) {
      try { existing.cliProcess.kill("SIGTERM"); } catch { /* already dead */ }
    }

    const session: WsSession = {
      workId,
      idle: false,
      browserSockets: new Set(),
      messageHistory: [],
      pendingMessages: [initialPrompt],
      model,
    };
    this.sessions.set(workId, session);

    this.spawnCli(session);
    return session;
  }

  /**
   * Resume an existing CLI session using --resume.
   * If CLI exits within 5s, the session is likely invalid.
   */
  resumeSession(workId: string, cliSessionId: string): WsSession {
    const existing = this.sessions.get(workId);
    if (existing?.cliProcess) {
      try { existing.cliProcess.kill("SIGTERM"); } catch { /* already dead */ }
    }

    const session: WsSession = {
      workId,
      cliSessionId,
      idle: false,
      browserSockets: new Set(),
      messageHistory: existing?.messageHistory ?? [],
      pendingMessages: [],
      model: existing?.model,
    };
    this.sessions.set(workId, session);

    this.spawnCli(session, cliSessionId);

    // Detect quick exit (resume failure)
    const proc = session.cliProcess;
    if (proc) {
      const quickExitTimer = setTimeout(() => {
        // If still alive after 5s, resume is working
      }, 5000);

      proc.on("exit", (code) => {
        clearTimeout(quickExitTimer);
        if (Date.now() - (proc as unknown as { _startedAt?: number })._startedAt! < 5000) {
          this.broadcastToBrowsers(workId, {
            event: "resume_failed",
            data: { workId, cliSessionId, exitCode: code },
          });
        }
      });
    }

    return session;
  }

  /**
   * Send a user message to the CLI via its WebSocket connection (NDJSON).
   * If CLI is not yet connected, the message is queued as pending.
   */
  sendMessage(workId: string, text: string): boolean {
    const session = this.sessions.get(workId);
    if (!session) return false;

    // Record in history
    session.messageHistory.push({
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    });

    if (session.cliSocket && session.cliSocket.readyState === WebSocket.OPEN) {
      this.sendToCli(session.cliSocket, text);
      session.idle = false;
      this.broadcastToBrowsers(workId, {
        event: "session_state",
        data: { idle: false },
      });
    } else {
      session.pendingMessages.push(text);
    }

    return true;
  }

  /**
   * Gracefully terminate the CLI process for a work.
   */
  killSession(workId: string): boolean {
    const session = this.sessions.get(workId);
    if (!session) return false;

    if (session.cliSocket) {
      try { session.cliSocket.close(); } catch { /* ignore */ }
      session.cliSocket = undefined;
    }

    if (session.cliProcess) {
      try { session.cliProcess.kill("SIGTERM"); } catch { /* already dead */ }
      // Force kill after 5s
      const proc = session.cliProcess;
      setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch { /* already dead */ }
      }, 5000);
      session.cliProcess = undefined;
    }

    session.idle = true;
    this.broadcastToBrowsers(workId, {
      event: "session_killed",
      data: { workId },
    });

    return true;
  }

  getSession(workId: string): WsSession | undefined {
    return this.sessions.get(workId);
  }

  getAllSessions(): Map<string, WsSession> {
    return this.sessions;
  }

  // ── CLI spawn ────────────────────────────────────────────────────────────

  private spawnCli(session: WsSession, resumeSessionId?: string): void {
    const sdkUrl = `ws://127.0.0.1:${this.serverPort}/ws/cli/${session.workId}`;

    const args = [
      "--sdk-url", sdkUrl,
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
    ];

    if (resumeSessionId) {
      args.push("--resume", resumeSessionId);
    } else {
      // Start with empty prompt; real prompt comes via WS after init
      args.push("-p", "");
    }

    if (session.model) {
      args.push("--model", session.model);
    }

    const proc = spawn("claude", args, {
      cwd: homedir(),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CLAUDECODE: undefined,  // Prevent agent-context detection
      },
    });

    // Tag with start time for quick-exit detection
    (proc as unknown as { _startedAt: number })._startedAt = Date.now();
    session.cliProcess = proc;

    // Capture stdout/stderr for debugging (the real data comes via WS)
    proc.stdout?.on("data", (data) => {
      const text = data.toString();
      if (text.trim()) {
        this.broadcastToBrowsers(session.workId, {
          event: "cli_stdout",
          data: { text },
        });
      }
    });

    proc.stderr?.on("data", (data) => {
      const text = data.toString();
      if (text.trim()) {
        this.broadcastToBrowsers(session.workId, {
          event: "cli_stderr",
          data: { text },
        });
      }
    });

    proc.on("exit", (code, signal) => {
      session.cliProcess = undefined;
      session.idle = true;
      this.broadcastToBrowsers(session.workId, {
        event: "cli_exited",
        data: { workId: session.workId, code, signal },
      });
    });

    proc.on("error", (err) => {
      this.broadcastToBrowsers(session.workId, {
        event: "cli_error",
        data: { workId: session.workId, error: err.message },
      });
    });
  }

  // ── CLI WebSocket handler ────────────────────────────────────────────────

  private handleCliConnection(workId: string, ws: WebSocket): void {
    const session = this.sessions.get(workId);
    if (!session) {
      ws.close(4004, "No session for this workId");
      return;
    }

    session.cliSocket = ws;

    // NDJSON buffer
    let buffer = "";

    ws.on("message", (raw) => {
      buffer += raw.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg: NdjsonMessage = JSON.parse(line);
          this.handleCliMessage(session, msg);
        } catch {
          // Malformed JSON line, skip
        }
      }
    });

    ws.on("close", () => {
      session.cliSocket = undefined;
      this.broadcastToBrowsers(workId, {
        event: "cli_disconnected",
        data: { workId },
      });
    });

    ws.on("error", (err) => {
      this.broadcastToBrowsers(workId, {
        event: "cli_ws_error",
        data: { workId, error: err.message },
      });
    });
  }

  private handleCliMessage(session: WsSession, msg: NdjsonMessage): void {
    const workId = session.workId;

    // Forward all events to browsers for live streaming
    this.broadcastToBrowsers(workId, {
      event: "cli_event",
      data: msg,
    });

    // system.init — save session ID, mark ready, flush pending
    if (msg.type === "system" && msg.subtype === "init") {
      if (msg.session_id) {
        session.cliSessionId = msg.session_id;
      }
      this.broadcastToBrowsers(workId, {
        event: "session_ready",
        data: { workId, cliSessionId: session.cliSessionId },
      });
      // Flush pending messages
      this.flushPending(session);
      return;
    }

    // assistant — forward text content to browsers
    if (msg.type === "assistant") {
      const text = this.extractText(msg.content);
      if (text) {
        this.broadcastToBrowsers(workId, {
          event: "assistant_text",
          data: { workId, text },
        });
      }
      return;
    }

    // result — mark idle, add to history, broadcast turn_complete
    if (msg.type === "result") {
      session.idle = true;
      const text = this.extractText(msg.result ?? msg.content);
      if (text) {
        session.messageHistory.push({
          role: "assistant",
          text,
          timestamp: new Date().toISOString(),
        });
      }
      this.broadcastToBrowsers(workId, {
        event: "turn_complete",
        data: {
          workId,
          idle: true,
          historyLength: session.messageHistory.length,
        },
      });
      return;
    }
  }

  private flushPending(session: WsSession): void {
    if (!session.cliSocket || session.cliSocket.readyState !== WebSocket.OPEN) return;

    const pending = session.pendingMessages.splice(0);
    for (const text of pending) {
      this.sendToCli(session.cliSocket, text);
    }
    if (pending.length > 0) {
      session.idle = false;
    }
  }

  private sendToCli(ws: WebSocket, text: string): void {
    const msg = JSON.stringify({
      type: "user",
      content: { type: "text", text },
    }) + "\n";
    ws.send(msg);
  }

  private extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((block: { type?: string; text?: string }) =>
          block.type === "text" ? block.text ?? "" : ""
        )
        .join("");
    }
    if (content && typeof content === "object" && "text" in content) {
      return (content as { text: string }).text;
    }
    return "";
  }

  // ── Browser WebSocket handler ────────────────────────────────────────────

  private handleBrowserConnection(workId: string, ws: WebSocket): void {
    const session = this.sessions.get(workId);

    if (!session) {
      // Send error and close
      ws.send(JSON.stringify({
        event: "error",
        data: { message: "No session for this workId" },
      }));
      ws.close(4004, "No session");
      return;
    }

    session.browserSockets.add(ws);

    // Send current session state
    ws.send(JSON.stringify({
      event: "session_state",
      data: {
        workId,
        connected: !!session.cliSocket,
        idle: session.idle,
        cliSessionId: session.cliSessionId,
        history: session.messageHistory,
      },
      timestamp: new Date().toISOString(),
    }));

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.action === "send" && typeof msg.text === "string") {
          this.sendMessage(workId, msg.text);
        }
      } catch {
        // Invalid JSON from browser, ignore
      }
    });

    ws.on("close", () => {
      session.browserSockets.delete(ws);
    });

    ws.on("error", () => {
      session.browserSockets.delete(ws);
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private broadcastToBrowsers(workId: string, payload: { event: string; data: unknown }): void {
    const session = this.sessions.get(workId);
    if (!session) return;

    const message = JSON.stringify({
      ...payload,
      timestamp: new Date().toISOString(),
    });

    for (const ws of session.browserSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  private extractWorkId(url: string, prefix: "cli" | "browser"): string | null {
    const match = url.match(new RegExp(`^/ws/${prefix}/([^/?]+)`));
    return match ? match[1] : null;
  }
}

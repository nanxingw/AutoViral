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
  browserSockets: Set<WebSocket>;
  cliProcess?: ChildProcess;
  idle: boolean;
  messageHistory: HistoryEntry[];
  model?: string;
}

interface NdjsonMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  content?: unknown;
  result?: unknown;
  message?: {
    content?: Array<{ type: string; text?: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ── WsBridge ─────────────────────────────────────────────────────────────────

export class WsBridge {
  private sessions: Map<string, WsSession> = new Map();
  private browserWss: WebSocketServer;

  constructor(_serverPort: number) {
    this.browserWss = new WebSocketServer({ noServer: true });
    this.browserWss.on("connection", (ws, req) => {
      const workId = this.extractWorkId(req.url ?? "");
      if (workId) this.handleBrowserConnection(workId, ws);
    });
  }

  // ── Upgrade handler ──────────────────────────────────────────────────────

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = req.url ?? "";
    if (url.match(/^\/ws\/browser\/[^/]+/)) {
      this.browserWss.handleUpgrade(req, socket, head, (ws) => {
        this.browserWss.emit("connection", ws, req);
      });
      return true;
    }
    return false;
  }

  // ── Session management ───────────────────────────────────────────────────

  ensureSession(workId: string): WsSession {
    let session = this.sessions.get(workId);
    if (!session) {
      session = {
        workId,
        idle: true,
        browserSockets: new Set(),
        messageHistory: [],
      };
      this.sessions.set(workId, session);
    }
    return session;
  }

  /**
   * Start a new CLI session. Spawns `claude -p <prompt> --output-format stream-json --verbose`.
   * stdin is closed immediately — the initial prompt goes via -p.
   */
  createSession(workId: string, initialPrompt: string, model?: string): WsSession {
    const existing = this.sessions.get(workId);
    if (existing?.cliProcess) {
      try { existing.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
    }

    const session: WsSession = {
      workId,
      idle: false,
      browserSockets: existing?.browserSockets ?? new Set(),
      messageHistory: existing?.messageHistory ?? [],
      model,
    };
    this.sessions.set(workId, session);

    this.spawnCli(session, initialPrompt);
    return session;
  }

  /**
   * Send a follow-up message using --resume + new -p.
   * Kills current CLI (if busy) and spawns a new one that resumes the session.
   */
  sendMessage(workId: string, text: string): boolean {
    const session = this.sessions.get(workId);
    if (!session) return false;

    session.messageHistory.push({
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    });

    // If CLI is still running (shouldn't normally be, but just in case)
    if (session.cliProcess) {
      try { session.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
      session.cliProcess = undefined;
    }

    if (!session.cliSessionId) {
      // No session to resume, start fresh with this message
      this.spawnCli(session, text);
    } else {
      // Resume previous session with new message
      this.spawnCli(session, text, session.cliSessionId);
    }

    session.idle = false;
    this.broadcastToBrowsers(workId, {
      event: "session_state",
      data: { idle: false },
    });

    return true;
  }

  killSession(workId: string): boolean {
    const session = this.sessions.get(workId);
    if (!session) return false;

    if (session.cliProcess) {
      try { session.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
      const proc = session.cliProcess;
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* dead */ } }, 5000);
      session.cliProcess = undefined;
    }

    session.idle = true;
    this.broadcastToBrowsers(workId, { event: "session_killed", data: { workId } });
    return true;
  }

  getSession(workId: string): WsSession | undefined {
    return this.sessions.get(workId);
  }

  getAllSessions(): Map<string, WsSession> {
    return this.sessions;
  }

  // ── CLI spawn ────────────────────────────────────────────────────────────

  private spawnCli(session: WsSession, prompt: string, resumeSessionId?: string): void {
    const args = [
      "-p", prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];

    if (resumeSessionId) {
      args.push("--resume", resumeSessionId);
    }

    if (session.model) {
      args.push("--model", session.model);
    }

    const proc = spawn("claude", args, {
      cwd: homedir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CLAUDE_CODE_ENTRYPOINT: "cli",
      },
    });

    session.cliProcess = proc;

    // Accumulate assistant text chunks for this turn
    let turnText = "";

    // Parse NDJSON from stdout
    let buffer = "";
    proc.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg: NdjsonMessage = JSON.parse(line);

          // system.init — capture session ID
          if (msg.type === "system" && msg.subtype === "init") {
            if (msg.session_id) {
              session.cliSessionId = msg.session_id;
            }
            this.broadcastToBrowsers(session.workId, {
              event: "session_ready",
              data: { workId: session.workId, cliSessionId: session.cliSessionId },
            });
            continue;
          }

          // assistant — forward all content blocks to browsers
          if (msg.type === "assistant" && msg.message?.content) {
            for (const block of msg.message.content as Array<Record<string, unknown>>) {
              if (block.type === "text" && block.text) {
                turnText += block.text as string;
                this.broadcastToBrowsers(session.workId, {
                  event: "assistant_text",
                  data: { workId: session.workId, text: block.text },
                });
              } else if (block.type === "thinking" && block.thinking) {
                this.broadcastToBrowsers(session.workId, {
                  event: "assistant_thinking",
                  data: { workId: session.workId, text: block.thinking },
                });
              } else if (block.type === "tool_use") {
                this.broadcastToBrowsers(session.workId, {
                  event: "tool_use",
                  data: { workId: session.workId, name: block.name, input: block.input },
                });
              }
            }
            continue;
          }

          // user (tool results) — forward to browsers
          if (msg.type === "user" && (msg as Record<string, unknown>).message) {
            const userMsg = (msg as Record<string, unknown>).message as Record<string, unknown>;
            const content = userMsg.content as Array<Record<string, unknown>> | undefined;
            if (content) {
              for (const block of content) {
                if (block.type === "tool_result") {
                  const resultContent = typeof block.content === "string"
                    ? block.content
                    : JSON.stringify(block.content);
                  this.broadcastToBrowsers(session.workId, {
                    event: "tool_result",
                    data: { workId: session.workId, content: resultContent?.slice(0, 500) },
                  });
                }
              }
            }
            continue;
          }

          // result — turn complete
          if (msg.type === "result") {
            session.idle = true;
            const resultText = typeof msg.result === "string" && msg.result
              ? msg.result
              : turnText;
            if (resultText) {
              session.messageHistory.push({
                role: "assistant",
                text: resultText,
                timestamp: new Date().toISOString(),
              });
            }
            // Update cliSessionId from result if present
            if (msg.session_id) {
              session.cliSessionId = msg.session_id;
            }
            this.broadcastToBrowsers(session.workId, {
              event: "turn_complete",
              data: {
                workId: session.workId,
                idle: true,
                result: resultText,
                sessionId: session.cliSessionId,
                historyLength: session.messageHistory.length,
              },
            });
            continue;
          }

          // Forward everything else
          this.broadcastToBrowsers(session.workId, {
            event: "cli_event",
            data: msg,
          });
        } catch {
          // Non-JSON line, ignore
        }
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
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

  // ── Browser WebSocket handler ────────────────────────────────────────────

  private handleBrowserConnection(workId: string, ws: WebSocket): void {
    const session = this.ensureSession(workId);
    session.browserSockets.add(ws);

    ws.send(JSON.stringify({
      event: "session_state",
      data: {
        workId,
        connected: !!session.cliProcess,
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
      } catch { /* invalid JSON */ }
    });

    ws.on("close", () => session.browserSockets.delete(ws));
    ws.on("error", () => session.browserSockets.delete(ws));
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

  private extractWorkId(url: string): string | null {
    const match = url.match(/^\/ws\/browser\/([^/?]+)/);
    return match ? match[1] : null;
  }
}

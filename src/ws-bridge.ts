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
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { loadConfig, dataDir } from "./config.js";
import { getWork, type Work, type PipelineStep } from "./work-store.js";
import { listSharedAssets } from "./shared-assets.js";
import { MemoryClient } from "./memory.js";

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
   * Build a system prompt with full context for a given work.
   */
  private async buildSystemPrompt(work: Work): Promise<string> {
    const config = await loadConfig();
    const port = config.port;

    // Determine current step (first non-done step)
    const steps = Object.entries(work.pipeline);
    const currentEntry = steps.find(([, s]) => s.status !== "done" && s.status !== "skipped");
    const currentStep = currentEntry ? currentEntry[1].name : steps[0]?.[1]?.name ?? "创作";

    // Workspace path
    const workspacePath = join(dataDir, "works", work.id);

    // Shared assets summary
    let sharedAssetsInfo = "";
    try {
      const assets = await listSharedAssets();
      const parts: string[] = [];
      for (const [category, files] of Object.entries(assets)) {
        if (files.length > 0) {
          parts.push(`- ${category}: ${files.join(", ")}`);
        } else {
          parts.push(`- ${category}: (空)`);
        }
      }
      sharedAssetsInfo = parts.length > 0 ? parts.join("\n") : "暂无公共素材";
    } catch {
      sharedAssetsInfo = "暂无公共素材";
    }

    // Memory context
    let memoryContext = "";
    try {
      const client = await MemoryClient.fromConfig();
      if (client) {
        const topic = work.topicHint ?? work.title;
        const platform = work.platforms[0] ?? "通用";
        memoryContext = await client.buildContext(topic, platform);
      }
    } catch {
      memoryContext = "";
    }

    const platforms = work.platforms.join(", ");

    return `你是AutoViral创作助手，正在帮用户创建一个${work.type}作品。
目标平台：${platforms}
当前阶段：${currentStep}

## 你的能力
- 调研：使用WebSearch工具搜索平台热门趋势，支持用户指定方向深入挖掘
- 生图：调用 curl http://localhost:${port}/api/generate/image 生成图片
- 生视频：调用 curl http://localhost:${port}/api/generate/video 生成视频
- 合成：使用ffmpeg命令剪辑视频（拼接片段+字幕+配乐+转场）
- 公共素材：通过 curl http://localhost:${port}/api/shared-assets 查看可用的公共素材（人物、配乐等）

## 当前项目workspace
${workspacePath}

## 公共素材库
${sharedAssetsInfo}

## 记忆上下文（如有）
${memoryContext}

## 规则
- 调研阶段：如果用户指定了方向，围绕该方向深入调研；否则广泛调研热门趋势
- 每生成一个素材前，先描述计划，等用户确认
- 素材生成后展示预览链接，等用户反馈
- 短视频制作：先生成首帧图片→用首帧图生成视频片段→ffmpeg剪辑合成
- 可随时引用公共素材库中的人物、配乐等素材
- 只支持抖音和小红书平台
- 当收到阶段切换指令（如"进入规划阶段"），立即确认切换并开始新阶段的工作
- 不要在未经用户确认的情况下自动跳转到下一阶段`;
  }

  /**
   * Start a new CLI session. Loads work context, builds system prompt,
   * then spawns `claude -p <prompt> --output-format stream-json --verbose`.
   */
  async createSession(workId: string, initialPrompt: string, model?: string): Promise<WsSession> {
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

    // Build system prompt from work context
    let systemPrompt = initialPrompt;
    try {
      const work = await getWork(workId);
      if (work) {
        const contextPrompt = await this.buildSystemPrompt(work);
        // Prepend system context, then append the user's initial message
        systemPrompt = contextPrompt + "\n\n---\n\n用户消息：" + initialPrompt;
      }
    } catch {
      // Fall back to plain initialPrompt
    }

    this.spawnCli(session, systemPrompt);
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

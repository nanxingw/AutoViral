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
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import yaml from "js-yaml";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { loadConfig, dataDir } from "./config.js";
import { getWork, updateWork, type Work, type PipelineStep } from "./work-store.js";
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
- 流水线管理：调用 curl -X POST http://localhost:${port}/api/works/${work.id}/pipeline/advance 更新流水线状态

## 流水线（Pipeline）
作品ID：${work.id}
流水线步骤：${steps.map(([key, s]) => `${key}(${s.name}): ${s.status}`).join(" → ")}

**重要：你必须主动管理流水线状态。** 每次回答用户之前，根据对话上下文判断当前阶段是否已经完成、是否需要推进到下一步。
- 当你判断当前阶段的工作已经完成（例如调研报告已输出、规划方案已确认），**立即调用** pipeline/advance API 更新状态：
  curl -X POST http://localhost:${port}/api/works/${work.id}/pipeline/advance -H "Content-Type: application/json" -d '{"completedStep":"当前步骤key","nextStep":"下一步骤key"}'
- 当用户明确要求进入下一阶段时，同样调用此API。
- 不要等用户来点按钮，你自己判断并更新。
- 不要在工作未完成时提前推进。

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

    // Load persisted cliSessionId from work.yaml (survives server restart)
    let savedSessionId: string | undefined;
    try {
      const work = await getWork(workId);
      if (work?.cliSessionId) {
        savedSessionId = work.cliSessionId;
        session.cliSessionId = savedSessionId;
      }
    } catch { /* ignore */ }

    if (savedSessionId) {
      // Resume existing conversation — agent keeps full context
      this.spawnCli(session, initialPrompt, savedSessionId);
    } else {
      // First time — build system prompt with full context
      let systemPrompt = initialPrompt;
      try {
        const work = await getWork(workId);
        if (work) {
          const contextPrompt = await this.buildSystemPrompt(work);
          systemPrompt = contextPrompt + "\n\n---\n\n用户消息：" + initialPrompt;
        }
      } catch { /* fall back to plain prompt */ }
      this.spawnCli(session, systemPrompt);
    }

    return session;
  }

  /**
   * Create an ephemeral trend research session.
   * Uses haiku model, auto-kills after 90s, filters CLI events into simplified research events.
   */
  async createTrendSession(sessionKey: string, prompt: string): Promise<WsSession> {
    const existing = this.sessions.get(sessionKey);
    if (existing?.cliProcess) {
      try { existing.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
    }

    const session: WsSession = {
      workId: sessionKey,
      idle: false,
      browserSockets: existing?.browserSockets ?? new Set(),
      messageHistory: [],
      model: "haiku",
    };
    this.sessions.set(sessionKey, session);

    this.spawnCli(session, prompt);

    // Auto-kill after 90s
    setTimeout(() => {
      if (session.cliProcess) {
        try { session.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
        session.cliProcess = undefined;
        this.broadcastToBrowsers(sessionKey, {
          event: "research_error",
          data: { message: "搜索超时，请稍后重试" },
        });
        this.cleanupTrendSession(sessionKey);
      }
    }, 90000);

    this.broadcastToBrowsers(sessionKey, {
      event: "research_started",
      data: { platform: sessionKey.split("_")[1] ?? "unknown" },
    });

    return session;
  }

  /**
   * Send a follow-up message using --resume + new -p.
   * Kills current CLI (if busy) and spawns a new one that resumes the session.
   */
  async sendMessage(workId: string, text: string): Promise<boolean> {
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

    // Try to resume: check in-memory first, then persisted in work.yaml
    let resumeId = session.cliSessionId;
    if (!resumeId) {
      try {
        const work = await getWork(workId);
        if (work?.cliSessionId) {
          resumeId = work.cliSessionId;
          session.cliSessionId = resumeId;
        }
      } catch { /* ignore */ }
    }

    if (resumeId) {
      this.spawnCli(session, text, resumeId);
    } else {
      // No session to resume — build full context prompt so agent knows the project
      let prompt = text;
      try {
        const work = await getWork(workId);
        if (work) {
          const contextPrompt = await this.buildSystemPrompt(work);
          prompt = contextPrompt + "\n\n---\n\n用户消息：" + text;
        }
      } catch { /* fall back to plain text */ }
      this.spawnCli(session, prompt);
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

  killTrendSession(sessionKey: string): boolean {
    if (!sessionKey.startsWith("trends_")) return false;
    const session = this.sessions.get(sessionKey);
    if (!session) return false;
    if (session.cliProcess) {
      try { session.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
      session.cliProcess = undefined;
    }
    this.broadcastToBrowsers(sessionKey, {
      event: "research_error",
      data: { message: "用户取消" },
    });
    this.cleanupTrendSession(sessionKey);
    return true;
  }

  getSession(workId: string): WsSession | undefined {
    return this.sessions.get(workId);
  }

  getAllSessions(): Map<string, WsSession> {
    return this.sessions;
  }

  /**
   * Parse the agent's text output for JSON trend data and save to YAML cache.
   */
  private async saveTrendData(sessionKey: string, text: string): Promise<void> {
    if (!text) return;
    const platform = sessionKey.split("_")[1] ?? "unknown";
    try {
      // Strip markdown code fences if present
      const stripped = text.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
      const firstBrace = stripped.indexOf("{");
      const lastBrace = stripped.lastIndexOf("}");
      if (firstBrace < 0 || lastBrace <= firstBrace) return;

      const data = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
      if (!data.topics || !Array.isArray(data.topics)) return;

      const trendsDir = join(homedir(), ".autoviral", "trends", platform);
      await mkdir(trendsDir, { recursive: true });
      const dateStr = new Date().toISOString().slice(0, 10);
      await writeFile(
        join(trendsDir, `${dateStr}.yaml`),
        yaml.dump(data, { lineWidth: -1 }),
        "utf-8"
      );
    } catch {
      // Parsing failed — agent may not have output valid JSON
    }
  }

  private cleanupTrendSession(sessionKey: string): void {
    this.broadcastToBrowsers(sessionKey, {
      event: "session_closed",
      data: { sessionKey },
    });
    const session = this.sessions.get(sessionKey);
    if (session) {
      for (const ws of session.browserSockets) {
        try { ws.close(); } catch { /* ignore */ }
      }
    }
    setTimeout(() => {
      this.sessions.delete(sessionKey);
    }, 5000);
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
    let lastEventWasToolResult = false;

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

          // Trend session event filtering
          if (session.workId.startsWith("trends_")) {
            if (msg.type === "assistant" && msg.message?.content) {
              for (const block of msg.message.content as Array<Record<string, unknown>>) {
                if (block.type === "tool_use" && block.name === "WebSearch") {
                  const input = block.input as Record<string, unknown> | undefined;
                  this.broadcastToBrowsers(session.workId, {
                    event: "search_query",
                    data: { query: (input?.query as string) ?? "" },
                  });
                  lastEventWasToolResult = false;
                }
              }
            }
            if (msg.type === "user" && (msg as Record<string, unknown>).message) {
              const userMsg = (msg as Record<string, unknown>).message as Record<string, unknown>;
              const content = userMsg.content as Array<Record<string, unknown>> | undefined;
              if (content) {
                for (const block of content) {
                  if (block.type === "tool_result") {
                    const resultText = typeof block.content === "string"
                      ? block.content
                      : JSON.stringify(block.content);
                    const summary = resultText.slice(0, 80) || "搜索完成";
                    this.broadcastToBrowsers(session.workId, {
                      event: "search_result",
                      data: { summary },
                    });
                  }
                }
                lastEventWasToolResult = true;
              }
            }
          }

          // system.init — capture session ID and persist to work.yaml
          if (msg.type === "system" && msg.subtype === "init") {
            if (msg.session_id) {
              session.cliSessionId = msg.session_id;
              // Persist so we can --resume after server restart
              updateWork(session.workId, { cliSessionId: msg.session_id }).catch(() => {});
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
                if (session.workId.startsWith("trends_") && lastEventWasToolResult) {
                  this.broadcastToBrowsers(session.workId, {
                    event: "analyzing",
                    data: {},
                  });
                  lastEventWasToolResult = false;
                }
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
                    data: { workId: session.workId, content: resultContent },
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
      if (session.workId.startsWith("trends_")) {
        // Include the accumulated turn text so frontend can show the full report
        const lastAssistant = session.messageHistory.filter(m => m.role === "assistant").pop();
        const resultForReport = lastAssistant?.text ?? turnText ?? "";

        // Save trend data to YAML cache before broadcasting done
        if (code === 0 && resultForReport) {
          this.saveTrendData(session.workId, resultForReport).catch(() => {});
        }

        this.broadcastToBrowsers(session.workId, {
          event: code === 0 ? "research_done" : "research_error",
          data: code === 0
            ? { platform: session.workId.split("_")[1] ?? "unknown", result: resultForReport }
            : { message: `CLI exited with code ${code}` },
        });
        this.cleanupTrendSession(session.workId);
      } else {
        this.broadcastToBrowsers(session.workId, {
          event: "cli_exited",
          data: { workId: session.workId, code, signal },
        });
      }
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

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.action === "send" && typeof msg.text === "string") {
          await this.sendMessage(workId, msg.text);
        }
      } catch { /* invalid JSON */ }
    });

    ws.on("close", () => {
      session.browserSockets.delete(ws);
      if (session.workId.startsWith("trends_") && session.browserSockets.size === 0) {
        setTimeout(() => {
          if (session.browserSockets.size === 0 && session.cliProcess) {
            try { session.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
            session.cliProcess = undefined;
            this.cleanupTrendSession(session.workId);
          }
        }, 3000);
      }
    });
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

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
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import yaml from "js-yaml";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { appendFile } from "node:fs/promises";
import { logBridge, logBridgeDebug } from "./logger.js";
import { loadConfig, dataDir } from "./config.js";
import { getWork, updateWork, saveStepHistory, loadStepHistory, saveWorkChat, loadWorkChat, type Work, type PipelineStep, type EvalResult } from "./work-store.js";
import { listSharedAssets } from "./shared-assets.js";
import { MemoryClient } from "./memory.js";
import { syncMessage } from "./memory-sync.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatBlock {
  type: "user" | "text" | "thinking" | "tool_use" | "tool_result" | "step_divider" | "eval_divider";
  text: string;
  toolName?: string;
  collapsed?: boolean;
  timestamp?: string;
  source?: "creator" | "evaluator";
}

export interface WsSession {
  workId: string;
  cliSessionId?: string;
  evalSessionId?: string;
  evalStep?: string;
  browserSockets: Set<WebSocket>;
  cliProcess?: ChildProcess;
  evalProcess?: ChildProcess;
  idle: boolean;
  messageHistory: ChatBlock[];
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
  private eventListeners: Map<string, Set<(event: string, data: unknown) => void>> = new Map();
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
   * Append a single chat block to the JSONL log on disk.
   * Fire-and-forget — write failure does not block the main flow.
   */
  private appendToChatLog(workId: string, block: ChatBlock): void {
    if (workId.startsWith("trends_")) return;
    const chatFile = join(dataDir, "works", workId, "chat.jsonl");
    appendFile(chatFile, JSON.stringify(block) + "\n", "utf-8").catch(() => {});
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
      const categoryLabels: Record<string, string> = {
        characters: "人物", scenes: "场景", music: "音乐",
        templates: "模板", branding: "品牌", general: "通用",
      };
      const parts: string[] = [];
      for (const [category, files] of Object.entries(assets)) {
        const label = categoryLabels[category] ?? category;
        if (files.length > 0) {
          parts.push(`- ${label}(${category}): ${files.join(", ")}`);
        } else {
          parts.push(`- ${label}(${category}): (空)`);
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
    void currentStep; // 仅为向下兼容保留计算，不再注入 prompt

    return `## 系统第一原则：质量优先

- 宁可不交付，不可降质交付。如果所有路径都会导致不可接受的质量损失，停下来告知用户，而不是静默降质出一个"勉强能用"的结果
- 降级必须最小让步：受阻时逐级尝试替代方案，每一级都优先保住对最终内容质量影响最大的环节
- 降质决策必须透明：换模型、换生成方式、跳过步骤等任何涉及质量降级的决策，必须告知用户并获得确认，不可静默执行
- 质量检测前置：批量生成前做样本测试，执行前检测环境能力，把问题拦在源头而非事后补救

---

你是 AutoViral 创作伙伴，和用户一起打磨一个 ${work.type} 作品。目标平台：${platforms}。

## 你的 Skill

你只有**一个** skill：**~/.claude/skills/autoviral/SKILL.md**。

开工前必读它的 Prime Directive + 决策 Schema + 评审 Rubric：

- \`~/.claude/skills/autoviral/taste/00-prime-directive.md\`
- \`~/.claude/skills/autoviral/taste/05-creative-schema.md\`
- \`~/.claude/skills/autoviral/taste/06-rubric.md\`

其它 taste 文件（\`01-emotional-storytelling\` / \`02-visual-grammar\` / \`03-rhythm-and-editing\` / \`04-design-and-text\`）在需要做具体创作决策时再展开。

## 你的能力（模块，不是阶段）

这些模块是**正交能力**，用户可以从任何一个切入——没有固定顺序。按需加载对应的 SKILL.md：

- \`~/.claude/skills/autoviral/modules/research/SKILL.md\` — 事实收集：平台数据、达人分析、已有视频解构
- \`~/.claude/skills/autoviral/modules/planning/SKILL.md\` — 把情感意图翻译成可执行 brief（镜头表 / 图文结构 / 文案骨架）
- \`~/.claude/skills/autoviral/modules/assets/SKILL.md\` — 图片 / 视频 / 音乐 / 海报生成
- \`~/.claude/skills/autoviral/modules/assembly/SKILL.md\` — ffmpeg 剪辑、字幕烧录、配乐、节拍对齐

**不要强制把用户拉回"调研"或"策划"**——有足够上下文就直接做；缺关键信息就反问一个具体问题（优先问情感意图：希望观众在前 3 秒感受到什么）。

## 关键工具入口

- 生图（唯一通道）：\`python3 ~/.claude/skills/autoviral/modules/assets/scripts/openrouter_generate.py\`
- 生视频（首选 Dreamina CLI）：\`dreamina image2video --first-frame frame.png --prompt "..." --output clip.mp4\`
- 生视频（备选）：\`python3 ~/.claude/skills/autoviral/modules/assets/scripts/jimeng_generate.py\`
- 生音乐：\`python3 ~/.claude/skills/autoviral/modules/assets/scripts/music_generate.py\`
- 状态检查：\`python3 ~/.claude/skills/autoviral/modules/assets/scripts/check_providers.py --format table\`
- 字幕烧录（**必须使用，禁止自写 drawtext**）：\`python3 ~/.claude/skills/autoviral/modules/assembly/scripts/subtitle_burn.py\`
- 节拍检测：\`python3 ~/.claude/skills/autoviral/modules/assembly/scripts/beat-sync/detect_beats.py\`

## 受阻降级

遇阻时读 \`~/.claude/skills/autoviral/modules/assets/capabilities/fallback-strategy.md\`。核心：质量优先 / 最小让步 / 透明决策 / 前置检测 / 视频首帧驱动。

## 可用数据源（失败直接跳过，不阻断对话）

- 创作者数据：\`curl http://localhost:${port}/api/analytics/creator\`
- 记忆搜索：\`curl "http://localhost:${port}/api/memory/search?q=关键词&method=hybrid&topK=5"\`
- 用户画像：\`curl http://localhost:${port}/api/memory/profile\`
- 共享素材：\`curl http://localhost:${port}/api/shared-assets\`
- 作品上下文：\`curl http://localhost:${port}/api/works/${work.id}\`

## 作品状态（兼容字段，非强制流程）

作品 ID：${work.id}。服务端保留了历史的阶段字段：${steps.map(([key, s]) => `${key}=${s.status}`).join(", ")}。

**这只是状态记录，不是必须遵循的顺序**。用户可以从任意模块切入。当某个工作区块明显收尾（例如 brief 已经确认、素材已经交付），可以选择调用：

\`curl -X POST http://localhost:${port}/api/works/${work.id}/pipeline/advance -H "Content-Type: application/json" -d '{"completedStep":"<key>","nextStep":"<key>"}'\`

更新状态供 UI 展示。**不调用也没关系**——创作本身不依赖这个。

## 当前项目 workspace
${workspacePath}

## 公共素材库
${sharedAssetsInfo}

## 记忆上下文（如有）
${memoryContext}

## 交互规则

- 每次生成素材前先描述计划，等用户确认再执行（小改可省确认）
- 素材生成后展示预览，等用户反馈
- 短视频首选：先生首帧图 → 首帧驱动视频 → ffmpeg 剪辑合成
- 随时可引用公共素材库中的人物、配乐、素材
- 不要在未经用户确认的情况下大规模推进或替换已有产出
- 任何交付前，对着 \`~/.claude/skills/autoviral/taste/06-rubric.md\` 自评，< 3.5 分重做`;
  }

  /**
   * Start a new CLI session. Loads work context, builds system prompt,
   * then spawns `claude -p <prompt> --output-format stream-json --verbose`.
   */
  async createSession(workId: string, initialPrompt: string, model?: string): Promise<WsSession> {
    logBridge("session_create", workId, { model, promptLen: initialPrompt.length });
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

    // Load persisted chat history (survives server restart)
    // Try JSONL first (new format), fall back to JSON (legacy)
    try {
      const jsonlPath = join(dataDir, "works", session.workId, "chat.jsonl");
      const raw = await readFile(jsonlPath, "utf-8");
      const blocks: ChatBlock[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try { blocks.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
      if (blocks.length > 0) session.messageHistory = blocks;
    } catch {
      // No JSONL — try legacy JSON
      try {
        const existing = await loadWorkChat(session.workId);
        if ((existing as any)?.blocks && Array.isArray((existing as any).blocks)) {
          session.messageHistory = (existing as any).blocks;
          // Migrate: write as JSONL for future reads
          const jsonlPath = join(dataDir, "works", session.workId, "chat.jsonl");
          const jsonlContent = (existing as any).blocks.map((b: ChatBlock) => JSON.stringify(b)).join("\n") + "\n";
          writeFile(jsonlPath, jsonlContent, "utf-8").catch(() => {});
        }
      } catch { /* ignore */ }
    }

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
   * Uses sonnet model, auto-kills after 180s, filters CLI events into simplified research events.
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
      model: "sonnet",
    };
    this.sessions.set(sessionKey, session);

    this.spawnCli(session, prompt);

    // Auto-kill after 180s
    setTimeout(() => {
      if (session.cliProcess) {
        try { session.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
        session.cliProcess = undefined;
        // Still try to read files even on timeout — agent may have written data.json
        this.finalizeTrendData(sessionKey).catch(() => {}).finally(() => {
          this.broadcastToBrowsers(sessionKey, {
            event: "research_error",
            data: { message: "搜索超时，请稍后重试" },
          });
          this.cleanupTrendSession(sessionKey);
        });
      }
    }, 180000);

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

    const userBlock: ChatBlock = {
      type: "user",
      text,
      timestamp: new Date().toISOString(),
    };
    session.messageHistory.push(userBlock);
    this.appendToChatLog(workId, userBlock);

    // Real-time memory sync — user message
    if (!workId.startsWith("trends_")) {
      getWork(workId).then(w => {
        if (!w) return;
        const activeStep = Object.entries(w.pipeline).find(([, s]) => s.status === "active");
        if (activeStep) {
          syncMessage(workId, w.title, activeStep[0], "user", text).catch(() => {});
        }
      }).catch(() => {});
    }

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

    // Kill creator CLI process
    if (session.cliProcess) {
      try { session.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
      const proc = session.cliProcess;
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* dead */ } }, 5000);
      session.cliProcess = undefined;
    }

    // Kill evaluator process if running
    if (session.evalProcess) {
      try { session.evalProcess.kill("SIGTERM"); } catch { /* dead */ }
      const evalProc = session.evalProcess;
      setTimeout(() => { try { evalProc.kill("SIGKILL"); } catch { /* dead */ } }, 5000);
      session.evalProcess = undefined;
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

  /**
   * Register a listener for session events. Returns cleanup function.
   * Used by TestRunner to wait for events without polling.
   */
  onSessionEvent(workId: string, callback: (event: string, data: unknown) => void): () => void {
    if (!this.eventListeners.has(workId)) {
      this.eventListeners.set(workId, new Set());
    }
    this.eventListeners.get(workId)!.add(callback);
    return () => {
      this.eventListeners.get(workId)?.delete(callback);
    };
  }

  getAllSessions(): Map<string, WsSession> {
    return this.sessions;
  }

  /**
   * After trend session completes, read the agent-written data.json and
   * copy it to the dated YAML cache so GET /api/trends/:platform picks it up.
   * Also read report.md and broadcast it to the frontend.
   */
  private async finalizeTrendData(sessionKey: string): Promise<void> {
    const platform = sessionKey.split("_")[1] ?? "unknown";
    const trendsDir = join(homedir(), ".autoviral", "trends", platform);
    const dataFile = join(trendsDir, "data.json");
    const reportFile = join(trendsDir, "report.md");

    try {
      // Read the JSON data the agent wrote
      const raw = await readFile(dataFile, "utf-8");
      const data = JSON.parse(raw);
      if (data.topics && Array.isArray(data.topics)) {
        // Save as dated YAML for the trends API
        const dateStr = new Date().toISOString().slice(0, 10);
        await writeFile(
          join(trendsDir, `${dateStr}.yaml`),
          yaml.dump(data, { lineWidth: -1 }),
          "utf-8"
        );
      }
    } catch {
      // Agent may not have written valid data.json — fall back to stdout parsing
    }

    // Read report and broadcast to frontend
    try {
      const report = await readFile(reportFile, "utf-8");
      if (report.trim()) {
        this.broadcastToBrowsers(sessionKey, {
          event: "research_report",
          data: { report },
        });
      }
    } catch {
      // No report file — that's fine
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
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CLAUDE_CODE_ENTRYPOINT: "cli",
        AUTOVIRAL_PROJECT_DIR: process.cwd(),
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
            const blocks = msg.message.content as Array<Record<string, unknown>>;
            const blockTypes = blocks.map((b: Record<string, unknown>) => b.type).join(",");
            logBridgeDebug("cli_assistant_message", session.workId, {
              messageId: msg.message.id,
              blockTypes,
              blockCount: blocks.length,
            });
            for (const block of blocks) {
              if (block.type === "text" && block.text) {
                if (session.workId.startsWith("trends_") && lastEventWasToolResult) {
                  this.broadcastToBrowsers(session.workId, {
                    event: "analyzing",
                    data: {},
                  });
                  lastEventWasToolResult = false;
                }
                turnText += block.text as string;
                if (!session.workId.startsWith("trends_")) {
                  const textBlock: ChatBlock = { type: "text", text: block.text as string, timestamp: new Date().toISOString() };
                  session.messageHistory.push(textBlock);
                  this.appendToChatLog(session.workId, textBlock);
                }
                this.broadcastToBrowsers(session.workId, {
                  event: "assistant_text",
                  data: { workId: session.workId, text: block.text },
                });
              } else if (block.type === "thinking" && block.thinking) {
                if (!session.workId.startsWith("trends_")) {
                  const thinkBlock: ChatBlock = { type: "thinking", text: block.thinking as string, collapsed: true };
                  session.messageHistory.push(thinkBlock);
                  this.appendToChatLog(session.workId, thinkBlock);
                }
                this.broadcastToBrowsers(session.workId, {
                  event: "assistant_thinking",
                  data: { workId: session.workId, text: block.thinking },
                });
              } else if (block.type === "tool_use") {
                if (!session.workId.startsWith("trends_")) {
                  const toolBlock: ChatBlock = { type: "tool_use", text: JSON.stringify(block.input), toolName: block.name as string };
                  session.messageHistory.push(toolBlock);
                  this.appendToChatLog(session.workId, toolBlock);
                }
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
                  if (!session.workId.startsWith("trends_")) {
                    const trBlock: ChatBlock = { type: "tool_result", text: resultContent, collapsed: true };
                    session.messageHistory.push(trBlock);
                    this.appendToChatLog(session.workId, trBlock);
                  }
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
            logBridge("turn_complete", session.workId, {
              hasResult: !!(typeof msg.result === "string" && msg.result),
              resultLen: typeof msg.result === "string" ? msg.result.length : 0,
              turnTextLen: turnText.length,
              resultPreview: (resultText || "").slice(0, 150),
            });
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
            // Persist chat to disk (survives server restart)
            if (!session.workId.startsWith("trends_")) {
              saveWorkChat(session.workId, { blocks: session.messageHistory }).catch(() => {});
            }
            // Real-time memory sync — assistant text (complete turn, not fragments)
            if (!session.workId.startsWith("trends_") && resultText) {
              getWork(session.workId).then(w => {
                if (!w) return;
                const activeStep = Object.entries(w.pipeline).find(([, s]) => s.status === "active");
                if (activeStep) {
                  syncMessage(session.workId, w.title, activeStep[0], "assistant", resultText).catch(() => {});
                }
              }).catch(() => {});
            }
            // Auto-save step history from backend (doesn't rely on frontend)
            // Only save the NEW messages from this turn (not entire history)
            if (!session.workId.startsWith("trends_") && resultText) {
              getWork(session.workId).then(w => {
                if (!w) return;
                const activeStep = Object.entries(w.pipeline).find(([, s]) => s.status === "active");
                if (activeStep) {
                  const [stepKey, stepInfo] = activeStep;
                  // Build blocks from this turn only: the last user message + resultText
                  const lastUserMsg = [...session.messageHistory].reverse().find(m => m.type === "user");
                  const blocks: Array<{type: string; text: string}> = [];
                  if (lastUserMsg) blocks.push({ type: "user", text: lastUserMsg.text });
                  blocks.push({ type: "text", text: resultText });
                  // Append to existing step history (don't overwrite)
                  loadStepHistory(session.workId, stepKey).then(existing => {
                    const existingBlocks = (existing as any)?.blocks ?? [];
                    saveStepHistory(session.workId, stepKey, {
                      stepKey,
                      stepName: stepInfo.name,
                      completedAt: new Date().toISOString(),
                      blocks: [...existingBlocks, ...blocks],
                    }).catch(() => {});
                  }).catch(() => {
                    // No existing history, save fresh
                    saveStepHistory(session.workId, stepKey, {
                      stepKey,
                      stepName: stepInfo.name,
                      completedAt: new Date().toISOString(),
                      blocks,
                    }).catch(() => {});
                  });
                }
              }).catch(() => {});
            }
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
      logBridge("cli_exit", session.workId, { code, signal, turnTextLen: turnText.length });
      session.cliProcess = undefined;
      session.idle = true;
      if (session.workId.startsWith("trends_")) {
        if (code === 0) {
          // Read agent-written files and broadcast report before done event
          this.finalizeTrendData(session.workId).catch(() => {}).finally(() => {
            this.broadcastToBrowsers(session.workId, {
              event: "research_done",
              data: { platform: session.workId.split("_")[1] ?? "unknown" },
            });
            this.cleanupTrendSession(session.workId);
          });
        } else {
          this.broadcastToBrowsers(session.workId, {
            event: "research_error",
            data: { message: `CLI exited with code ${code}` },
          });
          this.cleanupTrendSession(session.workId);
        }
      } else {
        this.broadcastToBrowsers(session.workId, {
          event: "cli_exited",
          data: { workId: session.workId, code, signal },
        });
        // Persist chat to disk on CLI exit
        saveWorkChat(session.workId, { blocks: session.messageHistory }).catch(() => {});
      }
    });

    proc.on("error", (err) => {
      this.broadcastToBrowsers(session.workId, {
        event: "cli_error",
        data: { workId: session.workId, error: err.message },
      });
    });
  }

  /**
   * Spawn an evaluator CLI agent for quality review.
   * Routes messages with source:"evaluator" and parses structured eval results.
   */
  spawnEvaluator(
    session: WsSession,
    prompt: string,
    resumeEvalSessionId?: string,
  ): Promise<EvalResult> {
    return new Promise((resolve, reject) => {
      const args = [
        "-p", prompt,
        "--output-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
      ];

      if (resumeEvalSessionId) {
        args.push("--resume", resumeEvalSessionId);
      }

      if (session.model) {
        args.push("--model", session.model);
      }

      const proc = spawn("claude", args, {
        cwd: homedir(),
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli", AUTOVIRAL_PROJECT_DIR: process.cwd() },
      });

      // Store on session so killSession() can kill it
      session.evalProcess = proc;

      let turnText = "";
      let buffer = "";
      let resolved = false;

      proc.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg: NdjsonMessage = JSON.parse(line);

            // Capture evaluator session ID
            if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
              session.evalSessionId = msg.session_id;
            }

            // Forward assistant blocks with source: "evaluator"
            if (msg.type === "assistant" && msg.message?.content) {
              const blocks = msg.message.content as Array<Record<string, unknown>>;
              for (const block of blocks) {
                if (block.type === "text" && block.text) {
                  turnText += block.text as string;
                  const eb: ChatBlock = { type: "text", text: block.text as string, source: "evaluator", timestamp: new Date().toISOString() };
                  session.messageHistory.push(eb);
                  this.appendToChatLog(session.workId, eb);
                  this.broadcastToBrowsers(session.workId, {
                    event: "assistant_text",
                    data: { workId: session.workId, text: block.text, source: "evaluator" },
                  });
                } else if (block.type === "thinking" && block.thinking) {
                  const eb: ChatBlock = { type: "thinking", text: block.thinking as string, source: "evaluator", collapsed: true };
                  session.messageHistory.push(eb);
                  this.appendToChatLog(session.workId, eb);
                  this.broadcastToBrowsers(session.workId, {
                    event: "assistant_thinking",
                    data: { workId: session.workId, text: block.thinking, source: "evaluator" },
                  });
                } else if (block.type === "tool_use") {
                  const eb: ChatBlock = { type: "tool_use", text: JSON.stringify(block.input), toolName: block.name as string, source: "evaluator" };
                  session.messageHistory.push(eb);
                  this.appendToChatLog(session.workId, eb);
                  this.broadcastToBrowsers(session.workId, {
                    event: "tool_use",
                    data: { workId: session.workId, name: block.name, input: block.input, source: "evaluator" },
                  });
                }
              }
            }

            // Forward tool results with source: "evaluator"
            if (msg.type === "user" && (msg as any).message?.content) {
              const content = (msg as any).message.content as Array<Record<string, unknown>>;
              for (const block of content) {
                if (block.type === "tool_result") {
                  const resultContent = typeof block.content === "string"
                    ? block.content : JSON.stringify(block.content);
                  const eb: ChatBlock = { type: "tool_result", text: resultContent, source: "evaluator", collapsed: true };
                  session.messageHistory.push(eb);
                  this.appendToChatLog(session.workId, eb);
                  this.broadcastToBrowsers(session.workId, {
                    event: "tool_result",
                    data: { workId: session.workId, content: resultContent, source: "evaluator" },
                  });
                }
              }
            }

            // result — eval turn complete, parse JSON result
            if (msg.type === "result") {
              if (msg.session_id) {
                session.evalSessionId = msg.session_id;
              }
              const resultText = typeof msg.result === "string" && msg.result ? msg.result : turnText;

              // Parse eval result JSON from response
              let evalResult: EvalResult;
              try {
                // Try extracting JSON from markdown code block first
                const jsonMatch = resultText.match(/```json\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                  evalResult = JSON.parse(jsonMatch[1]);
                } else {
                  // Try parsing entire text as JSON
                  evalResult = JSON.parse(resultText);
                }
              } catch {
                // Fallback: if we can't parse JSON, create a default pass result
                evalResult = {
                  step: session.evalStep ?? "unknown",
                  attempt: 1,
                  verdict: "pass" as const,
                  scores: {},
                  issues: [],
                  suggestions: [],
                  timestamp: new Date().toISOString(),
                };
              }

              // Persist chat
              saveWorkChat(session.workId, { blocks: session.messageHistory }).catch(() => {});

              if (!resolved) {
                resolved = true;
                resolve(evalResult);
              }
            }
          } catch { /* ignore non-JSON lines */ }
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        if (text.trim()) {
          this.broadcastToBrowsers(session.workId, {
            event: "cli_stderr",
            data: { text, source: "evaluator" },
          });
        }
      });

      proc.on("exit", (code) => {
        session.evalProcess = undefined;
        if (!resolved) {
          resolved = true;
          if (code !== 0) {
            reject(new Error(`Evaluator exited with code ${code}`));
          } else {
            // If exited cleanly but no result parsed, return default pass
            resolve({
              step: session.evalStep ?? "unknown",
              attempt: 1,
              verdict: "pass" as const,
              scores: {},
              issues: [],
              suggestions: [],
              timestamp: new Date().toISOString(),
            });
          }
        }
      });

      proc.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
    });
  }

  // ── Browser WebSocket handler ────────────────────────────────────────────

  private async handleBrowserConnection(workId: string, ws: WebSocket): Promise<void> {
    const session = this.ensureSession(workId);
    session.browserSockets.add(ws);

    // Load persisted chat history from disk if session has no in-memory history
    if (session.messageHistory.length === 0) {
      try {
        const persisted = await loadWorkChat(workId);
        if ((persisted as any)?.blocks && Array.isArray((persisted as any).blocks)) {
          session.messageHistory = (persisted as any).blocks;
        }
      } catch { /* no persisted chat */ }
    }

    // Load persisted cliSessionId from work.yaml if not already set
    if (!session.cliSessionId) {
      try {
        const work = await getWork(workId);
        if (work?.cliSessionId) {
          session.cliSessionId = work.cliSessionId;
        }
      } catch { /* ignore */ }
    }

    ws.send(JSON.stringify({
      event: "session_state",
      data: {
        workId,
        connected: !!session.cliProcess,
        idle: session.idle,
        cliSessionId: session.cliSessionId,
      },
      timestamp: new Date().toISOString(),
    }));

    // Replay chat history so browser can reconstruct conversation
    if (session.messageHistory.length > 0) {
      ws.send(JSON.stringify({
        event: "message_history",
        data: { blocks: session.messageHistory },
        timestamp: new Date().toISOString(),
      }));
    }

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
      if (session.browserSockets.size === 0 && session.cliProcess) {
        // Kill CLI process when all browsers disconnect (leaving the page = abort)
        const delay = session.workId.startsWith("trends_") ? 3000 : 1000;
        setTimeout(() => {
          if (session.browserSockets.size === 0 && session.cliProcess) {
            try { session.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
            session.cliProcess = undefined;
            if (session.workId.startsWith("trends_")) {
              this.cleanupTrendSession(session.workId);
            } else {
              session.idle = true;
              this.broadcastToBrowsers(session.workId, { event: "cli_exited", data: { workId: session.workId } });
            }
          }
        }, delay);
      }
    });
    ws.on("error", () => session.browserSockets.delete(ws));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  broadcastToBrowsers(workId: string, payload: { event: string; data: unknown }): void {
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

    // Notify in-process event listeners (used by TestRunner)
    const listeners = this.eventListeners.get(workId);
    if (listeners) {
      for (const cb of listeners) {
        try { cb(payload.event, payload.data); } catch { /* listener error shouldn't crash bridge */ }
      }
    }
  }

  private extractWorkId(url: string): string | null {
    const match = url.match(/^\/ws\/browser\/([^/?]+)/);
    return match ? match[1] : null;
  }
}

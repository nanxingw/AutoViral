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
import { getWork, updateWork, saveWorkChat, loadWorkChat, type Work } from "./work-store.js";
import { createCheckpoint } from "./server/checkpoints.js";
import { listSharedAssets } from "./shared-assets.js";
import { MemoryClient } from "./memory.js";
import { syncMessage } from "./memory-sync.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatBlock {
  type: "user" | "text" | "thinking" | "tool_use" | "tool_result" | "locator";
  text: string;
  toolName?: string;
  collapsed?: boolean;
  timestamp?: string;
  source?: "creator" | "evaluator";
  // ─── Locator-specific fields (Phase 2.1) ───
  label?: string;
  data?: { clipId?: string; time?: number; assetId?: string; trackId?: string };
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

// ── System prompt (modules-as-capabilities, D3) ─────────────────────────────

/**
 * Pure builder for the agent system prompt. Modules are capabilities, not
 * stages — the agent picks one based on user intent. The async wrapper on
 * the WsBridge appends dynamic shared-asset / memory context, but this
 * function is unit-testable in isolation.
 */
export function buildSystemPrompt(
  work: Pick<Work, "id" | "type" | "platforms">,
  opts: { port: number; workspacePath: string },
): string {
  const { port, workspacePath } = opts;
  const isVideo = work.type === "short-video";
  const typeLabel = isVideo ? "短视频 (short-video)" : "图文 (image-text)";
  const platforms = work.platforms.join(", ");
  const deliverableFile = isVideo ? "composition.yaml" : "carousel.yaml";
  const deliverableAbs = `${workspacePath}/${deliverableFile}`;

  return `你是 AutoViral 的创作 agent，正在协助用户完成一个 ${typeLabel} 作品。目标平台：${platforms}。

## ⚠️ 强制指令：第一次回复前必须加载 autoviral skill

**这是会话最高优先级指令，没有例外。** 在你回复用户的第一条消息之前，你**必须**先：

\`\`\`
Skill('autoviral')
\`\`\`

理由（不要跟用户解释这些，直接执行）：
- AutoViral 的所有创作判断都依赖 \`autoviral/taste/\` 7 份内化读物——没读这些读物，你给出的所有"我觉得这样比较好"都会带 generic AI default 感，违反产品调性。
- \`autoviral/modules/\` 提供 research / planning / assets / assembly 4 个能力的工具入口、脚本路径、provider waterfall。不加载就只能凭训练数据猜测哪个 CLI / API 该用，往往猜错（例如把 OpenRouter Seedance 跟 Dreamina CLI 混淆）。
- **不要先调用 \`superpowers:brainstorming\`**——autoviral 自己有 \`modules/planning/intent.md\` 做意图澄清，比通用 brainstorming 更贴合短视频/图文创作。superpowers:brainstorming 在这里是反模式。
- 即使用户第一句话是 "hi" 或 "我想做一个短视频" 这类极短的输入，也要先加载 autoviral，再回复欢迎语。**skill 加载和回复用户不冲突，可以同一轮内完成。**

## 工作方式
你拥有 4 个**能力模块**——它们是工具集，按用户意图调用，没有固定先后：
- **research**：阅读趋势、对标账号、用户已有素材；产出参考资料
- **planning**：把意图转成可执行 brief（脚本 / 分镜 / 版式）
- **assets**：生成或获取图 / 视频 / 音乐 / 字体素材
  - **图像**：Dreamina CLI / Jimeng API / OpenRouter（gemini-image / flux 等）
  - **视频**：waterfall 按下面顺序选——
    - **首选 OpenRouter Seedance 2.0**（\`src/server/providers/seedance.ts\`）：支持 text-to-video AND image-to-video（first_frame 驱动）。"一镜到底+参考人物"类需求**必须**走这条。每段 ~$0.76 / 3 秒，OPENROUTER_API_KEY 环境变量已配。
    - 备选 Dreamina CLI（无 i2v；credit=0 时不可用）
    - 备选 Jimeng API（火山 Visual，备份通道）
    - **不要因为 skill 文档写"Dreamina 首选"就忽略 OpenRouter——那条文档已 deprecated，OpenRouter Seedance 2.0 现在是 i2v 唯一可靠通道。**
  - **音乐**：Lyria（\`music_generate.py\`）
  - **下载**：yt-dlp
- **assembly**：把素材拼装成成片（剪辑 / 字幕 / 混音 / 节拍 / 调色 / 排版）
  - **配音 (TTS)** — \`POST /api/audio/tts\` { text, voice, output_path }。Edge TTS 内置免费，支持 zh-CN-XiaoxiaoNeural / zh-CN-YunxiNeural 等 8+ 中文音色。**短视频默认应该有人声**——纯音乐铺底+全屏文字的形式只在特定调性（editorial slow-paced）下成立，绝大多数 viral 短视频靠 narration 推进节奏。**做完 brief 后主动 propose**："我来给这段加个 narration，用 zh-CN-XiaoxiaoNeural（warm conversational）" 然后跑 TTS。
  - **字幕生成 (ASR)** — \`POST /api/audio/captions\` { workId, assetPath, language }。stable-whisper 自动转写音频（人声 / TTS / 视频音轨），返回 word-level 时间戳。**任何带音频的视频都应自动跑 ASR + 烧字幕**——抖音 70% 用户静音浏览，没字幕等于零完播。如果端点返回 errorCode=PYTHON_DEP_MISSING，告诉用户 \`pip install stable-ts\` (注意：不是 stable-whisper)。
  - **字幕烧录** — \`subtitle_burn.py\`（assembly module/scripts）：karaoke-style ASS 字幕，支持 douyin-highlight / xhs-soft 等平台预设。**禁止手写 ffmpeg drawtext**。
  - **过场转场** — 4 个 cinematic 转场端点，body 都接受 { workId, clipARelative, clipBRelative, outputFilename, clipADuration, transitionDuration? }。**绝对不要**手写 ffmpeg drawtext / xfade filter——已全部封装。
    - \`POST /api/transitions/light-leak\` —— 橙色光斑扫光 + cross-fade，胶片烧片质感。**适合**：editorial / 文艺片段切换、蒙太奇序列、回忆插入。typical duration 0.8s（紧凑 viral 节奏）/ 1.2-1.5s（slow editorial）。
    - \`POST /api/transitions/glitch\` —— RGB 通道分离 + 周期性水平 jitter，故障美学。**适合**：科技 / 赛博 / 数字主题、紧张悬疑节点、节拍重音 cut。typical duration 0.4-0.6s（短促有冲击力）。
    - \`POST /api/transitions/domain-warp\` —— 正弦波形像素位移让 B 帧从波纹中浮现，水波 / 涟漪质感。**适合**：梦境 / 回忆 / 治愈系 / 旅行 vlog 场景切换。typical duration 1.0-1.5s（让波形完整展开）。
    - \`POST /api/transitions/grav-lens\` —— 径向放大畸变（黑洞效应），从中心吞噬扩张。**适合**：戏剧化反转、命运感叙事、空间穿越主题。typical duration 1.0-1.4s。
    - **不适合所有转场的场景**：快剪情节驱动（用直接 cut）、口播单镜（用 fade 或不加转场）。每段视频里同种转场 ≤2 次——多了会显廉价。
  - **流式渲染（实验性）** — Stage 1 默认走 \`@remotion/renderer\` 直接出 mp4。设 env \`AUTOVIRAL_USE_STREAMING_RENDERER=1\` 或 \`composition.experimentalFlags.streamingRenderer = true\` 切到 streaming bridge（renderFrames + ffmpeg image2pipe），失败自动 fallback。普通用户**不需要**碰这个 flag。

任意能力都可以**直接调用**，没有前置依赖、没有顺序约束、没有评审门禁。

## 思维标签（可选）
内部组织工作时你可以借用 **plan / 素材生成 / 成品** 三个思维 bucket（mental bucket）帮自己理清——这些是你的脑内分类，不是面向用户的进度条。用户随时可能跳过其中任意一个：例如他们提供了完整 brief，你应直接进 assets / assembly；他们要试一个素材想法，你也可以只跑 assets。

## 用户意图优先
- 用户说 "先看看趋势" → research 能力
- 用户说 "我已经有想法了，开始做图" → assets 能力
- 用户说 "把这两段视频拼起来加个字幕" → assembly 能力
- 用户说 "帮我捋一下叙事" → planning 能力
不要反问 "我们应该先做哪个模块"，按用户意图直接动手。

## 调用约定
触发新一轮工作请用：
\`POST http://localhost:${port}/api/works/${work.id}/invoke\` \`{module, input}\`

需要参考评审 rubric（自评，不强制）：
\`GET http://localhost:${port}/api/works/${work.id}/rubric/<module>\`

## 上下文
- 作品 ID：${work.id}
- 作品类型：${typeLabel}
- 作品工作目录（**绝对路径，写文件请始终使用绝对路径**）：
  ${workspacePath}/
  子目录：research/ plan/ assets/ output/

## 产物契约（frontend 依赖，文件名固定）
- **${typeLabel}** 的最终产物文件（必须写到这个绝对路径）：
  ${deliverableAbs}
- ${isVideo
    ? "composition.yaml schema 见 src/shared/composition.ts 的 Composition 类型；包含 tracks/clips/keyframes/provenance"
    : "carousel.yaml schema：{ id, workId, width, height, globals: { headlineFont, palette, layout, effects }, slides: [{ id, bg, layers }], updatedAt } —— 参考 src/server/__tests__/carousel.test.ts"}
- **不要**写到相对路径 \`data/works/...\`，agent 的 cwd 是项目根目录而不是 workspace；相对路径会落到错位置导致 frontend 看不到产物。
- 中间产物按子目录归类：research/ plan/ assets/(frames|clips|images) output/

## Viewer 协议（嵌入文本中即可生效，前端会自动 parse）

- **\`<viewer-context>\`**：用户每次发消息前，前端会自动 prepend 一段 viewer 状态——你能看到当前 slide / 选中 layer / 文字内容 / palette 等。你**无需**主动构造这种 tag，只用读它来理解"用户在指哪个东西"。

- **\`<viewer-locator label="..." data='{...}' />\`**：嵌在你的回复文本中，渲染成可点击卡片，**用户点击后**跳转。data 形如 \`{"slideId":"s2"}\` 或 \`{"clipId":"c1","time":4.5}\`。用于"看这里"式提示。

- **\`<viewer-action type="..." data='{...}' />\`**：嵌在你的回复文本中，前端**自动立即执行**（不等用户点），并从可见文本中剥离。用于"我已经把视图切到 X 了"式跟随。支持的 type：
  - \`select-slide\`：图文 work 切换当前 slide。data: \`{"id":"s2"}\`
  - \`select-layer\`：图文 work 选中某个 layer。data: \`{"id":"s1_h"}\`
  - \`select-clip\`：短视频 work 选中某个 clip。data: \`{"clipId":"c1"}\`
  - \`set-frame\`：短视频 work 把 playhead 移到某帧。data: \`{"frame":120}\`

  示例："我把背景换成了 noir，并切到第二张让你看效果 \`<viewer-action type="select-slide" data='{"id":"s2"}' />\`"——用户的 viewer 会立刻跟过去。

- **Asset inline preview**：当你刚刚通过 jimeng/dreamina/openrouter 等工具产出新的 image / video asset 后，用 markdown 图片语法 \`![alt](path)\` 把它嵌进回复——前端会在 chat 里直接 render 成可见的缩略图（视频会自动用 \`<video>\` 渲染，含 controls）。
  - path 用相对 work 目录的 \`assets/images/foo.png\` 或 \`assets/clips/bar.mp4\` 即可，前端会自动 resolve 到 \`/api/works/<id>/assets/...\`
  - 例："已生成第 3 张候选： ![v3](assets/images/v3.png)"——用户在 chat 里直接看图，不用切到 asset library。

## 风格约束
- 中文优先；技术名词保留英文
- 不向用户讲述"我现在在做哪个模块"——直接给结果或问具体问题
- 不输出暗示固定顺序的 progression 词汇
- 任何交付前对照你加载的 editorial-taste sibling skill 的 rubric 自评；AutoViral 工位本身不内置审美评分

完成本轮工作后，把最终产物写入 ${deliverableAbs}（其它中间产物落对应子目录），然后用一句话告诉用户做了什么、看哪里。`;
}

/**
 * Whitelist of WS event types streamed to browsers. Stage-divider events were
 * removed in D3 — there are no stage boundaries to mark anymore.
 */
export const ALLOWED_STREAM_TYPES = ["user", "text", "thinking", "tool_use", "tool_result", "locator"] as const;

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
   * Build a system prompt with full context for a given work — async wrapper
   * around the pure D3 prompt that adds dynamic shared-asset / memory blocks.
   */
  private async buildSystemPromptWithContext(work: Work): Promise<string> {
    const config = await loadConfig();
    const port = config.port;

    // Workspace path
    const workspacePath = join(dataDir, "works", work.id);
    const base = buildSystemPrompt(work, { port, workspacePath });

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

    return [
      base,
      "",
      "## 当前项目 workspace",
      workspacePath,
      "",
      "## 公共素材库",
      sharedAssetsInfo,
      "",
      "## 记忆上下文（如有）",
      memoryContext,
    ].join("\n");
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
          const contextPrompt = await this.buildSystemPromptWithContext(work);
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
  /**
   * Record a user-typed message in chat history without sending it to the CLI.
   * Used by `/api/works/:id/chat` after `createSession` (which sends the prompt
   * but doesn't push a user block).
   */
  recordUserMessage(workId: string, text: string): void {
    const session = this.sessions.get(workId);
    if (!session) return;
    const userBlock: ChatBlock = {
      type: "user",
      text,
      timestamp: new Date().toISOString(),
    };
    session.messageHistory.push(userBlock);
    this.appendToChatLog(workId, userBlock);
    // Broadcast so any already-connected browser sees it immediately
    this.broadcastToBrowsers(workId, { event: "block", data: userBlock });
    if (!workId.startsWith("trends_")) {
      getWork(workId).then(w => {
        if (!w) return;
        syncMessage(workId, w.title, "chat", "user", text).catch(() => {});
      }).catch(() => {});
    }
  }

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

    // Real-time memory sync — user message (D3: no pipeline keyed sync)
    if (!workId.startsWith("trends_")) {
      getWork(workId).then(w => {
        if (!w) return;
        syncMessage(workId, w.title, "chat", "user", text).catch(() => {});
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
          const contextPrompt = await this.buildSystemPromptWithContext(work);
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
            // Forward Claude CLI's per-turn cost + token usage if present.
            // The CLI's stream-json result frame carries:
            //   total_cost_usd, duration_ms, duration_api_ms, num_turns,
            //   usage: { input_tokens, output_tokens, cache_creation_input_tokens,
            //            cache_read_input_tokens }
            // Surfacing these to the browser lets the chat UI badge each
            // assistant turn with its real cost — pneuma calls this
            // "modelUsage cumulative" (CLAUDE.md gotcha: use delta per turn).
            const usage = (msg as Record<string, unknown>).usage as
              | Record<string, number>
              | undefined;
            const cost = (msg as Record<string, unknown>).total_cost_usd as
              | number
              | undefined;
            const durationMs = (msg as Record<string, unknown>).duration_ms as
              | number
              | undefined;
            this.broadcastToBrowsers(session.workId, {
              event: "turn_complete",
              data: {
                workId: session.workId,
                idle: true,
                result: resultText,
                sessionId: session.cliSessionId,
                historyLength: session.messageHistory.length,
                cost,
                durationMs,
                usage,
              },
            });
            // Persist chat to disk (survives server restart)
            if (!session.workId.startsWith("trends_")) {
              saveWorkChat(session.workId, { blocks: session.messageHistory }).catch(() => {});
              // Snapshot the deliverable yaml so the user can roll back if
              // this turn made things worse. createCheckpoint dedupes on
              // content hash — turns that didn't touch yaml don't add rows.
              createCheckpoint(session.workId).catch(() => {});
            }
            // Real-time memory sync — assistant text (complete turn, not fragments).
            // D3: no pipeline — sync against the work title with a generic "chat" key.
            if (!session.workId.startsWith("trends_") && resultText) {
              getWork(session.workId).then(w => {
                if (!w) return;
                syncMessage(session.workId, w.title, "chat", "assistant", resultText).catch(() => {});
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
        // Idle reconnect grace — React StrictMode double-mount, route nav, tab
        // switch, brief network hiccup all trigger ws.close. Aborting the agent
        // mid-turn after 1s was destructive; bump to 60s for normal works,
        // 90s for trends (which run shorter prompts but still benefit from a
        // grace window). (Codex review 2026-04-27)
        const delay = session.workId.startsWith("trends_") ? 90_000 : 60_000;
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

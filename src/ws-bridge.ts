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
import { logBridge, logBridgeDebug } from "./infra/logger.js";
import { loadConfig, dataDir } from "./infra/config.js";
import { PACKAGE_ROOT } from "./infra/paths.js";
import { getWork, updateWork, saveWorkChat, loadWorkChat, type Work } from "./domain/work-store.js";
import { createCheckpoint } from "./server/checkpoints.js";
import { listSharedAssets } from "./shared-assets.js";
import { MemoryClient } from "./domain/memory.js";
import { syncMessage } from "./memory-sync.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Media the user attached to a chat message. Parsed out of the <attachments>
 *  envelope when the message is recorded, so the persisted/reloaded user block
 *  carries structured thumbnails instead of the raw envelope XML. */
export interface ChatBlockAttachment {
  path: string;
  url: string;
  name: string;
  kind: string;
}

export interface ChatBlock {
  type: "user" | "text" | "thinking" | "tool_use" | "tool_result" | "locator";
  text: string;
  toolName?: string;
  collapsed?: boolean;
  timestamp?: string;
  source?: "creator" | "evaluator";
  /** Set on user blocks that carried media attachments. */
  attachments?: ChatBlockAttachment[];
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

## ⚠️ 第一步：加载 autoviral 操作手册

在回复用户第一条消息之前，先调用一次：

\`\`\`
Skill('autoviral')
\`\`\`

它是 agent-agnostic 的工位操作手册（manual/00-05），告诉你：怎么用 \`autoviral\` CLI 驱动 Studio、composition.yaml 的 schema、命名与单位约定。**加载后你就拥有 schema 与命令参考，不需要去读项目源码（\`src/...\`）。** skill 加载和回复用户不冲突，可以同一轮内完成——即使用户只说 "hi"，也先加载再回欢迎语。

审美 / 选题不在这个 skill 里：AutoViral 工位本身不评审美。需要 taste 时按需加载 sibling skill（\`editorial-pro\` / \`viral-hooks-zh\` / \`lyric-video\` 等）；需要工程协作流程用 \`mattpocock/*\`（\`to-prd\` / \`diagnose\` / \`tdd\` 等），不要用 \`superpowers:*\`。

## 怎么驱动这个工位：autoviral CLI

组合编辑 / UI 控制 / 导出 / 抓取都走你 PATH 上的 \`autoviral\` 命令——原子写入、zod 校验，并**直接驱动右侧 Studio** 让用户实时看到你的动作。完整命令见 \`autoviral docs 03-cli-reference\`，常用：

- **看**：\`autoviral comp show\`（整份 composition）· \`autoviral list clips|assets\` · \`autoviral whoami\`（自检）
- **改 composition**：\`autoviral clip add --src assets/clips/x.mp4 --track video --offset 75 --duration 5\` · \`autoviral clip set <id> --opacity 0.5\` · \`autoviral clip remove <id>\`
- **驱动 UI**（让用户看到你在指哪）：\`autoviral select clip <id>\` · \`autoviral seek 12.5\` · \`autoviral play|pause\` · \`autoviral toast "已生成 16 段" --kind success\` · \`autoviral progress start|step|done\`
- **问用户**（破坏性 / 花钱 / >10s 的操作先问）：\`autoviral ask "现在渲染吗？" --yes-no\`（exit 0=yes / 1=no）
- **导出**：\`autoviral export\`（成片）· \`autoviral render\`（快预览）
- **抓取**：\`autoviral ingest youtube <url> --lang zh-CN\`（下载 + 转写 + 翻译 + 生成 overlay 字幕，一条龙）
- **查文档**：\`autoviral docs [topic]\` 打印任意手册章节；schema 用 \`autoviral docs 02-composition-schema\` 或直接 \`autoviral comp show\`——**永远不要去读 \`src/\` 源码**

环境变量 \`AUTOVIRAL_WORK_ID\` / \`AUTOVIRAL_PORT\` 已为你注入，命令开箱即用；动手前先 \`autoviral whoami\` 自检。

## 素材生成（CLI 暂未封装，直连 HTTP \`localhost:${port}\`）

- **图像** — \`POST /api/generate/image\` { workId, prompt, filename, width?, height?, referenceImage? }。OpenRouter，用户在 Settings 配了 OPENROUTER_API_KEY 即启用。
- **视频** — \`POST /api/generate/video\` { workId, prompt, filename, firstFrame?, lastFrame?, resolution? }。Seedance 2.0，支持 text-to-video 与 image-to-video（first_frame 驱动），~$0.76 / 3 秒。
- **配音 TTS** — \`POST /api/audio/tts\` { text, voice, output_path, language?, style? }。Edge TTS 内置免费（中文 zh-CN-XiaoxiaoNeural 等、英文 en-US-AriaNeural 等），无 key 时自动 fallback OpenAI。**短视频默认应该有人声**——绝大多数 viral 短视频靠 narration 推进节奏；做完 brief 主动 propose 加旁白。
- **字幕 ASR** — \`POST /api/audio/captions\` { workId, assetPath, language }。stable-whisper 转写出 word-level 时间戳。**抖音 70% 用户静音浏览，任何带音频的视频都该跑 ASR 加字幕**（字幕走 composition 的 \`captionStrategy: overlay\` 渲染，见 manual/02——不要手写 ffmpeg drawtext）。报 PYTHON_DEP_MISSING 就让用户 \`pip install stable-ts\`（注意不是 stable-whisper）。
- **混音** \`POST /api/audio/mix\`（多轨混音 / 音量平衡）。
- **过场转场** — 4 个 cinematic 端点，body 都接受 { workId, clipARelative, clipBRelative, outputFilename, clipADuration, transitionDuration? }。**绝不手写 ffmpeg xfade**：
  - \`POST /api/transitions/light-leak\` 橙色扫光 + cross-fade，胶片质感（editorial 切换 / 蒙太奇 / 回忆）。0.8s 紧凑 viral / 1.2-1.5s slow editorial。
  - \`POST /api/transitions/glitch\` RGB 分离 + jitter 故障美学（科技 / 赛博 / 节拍重音）。0.4-0.6s。
  - \`POST /api/transitions/domain-warp\` 波形像素位移（梦境 / 治愈 / 旅行 vlog）。1.0-1.5s。
  - \`POST /api/transitions/grav-lens\` 径向畸变黑洞效应（戏剧反转 / 空间穿越）。1.0-1.4s。
  - 快剪用直接 cut、口播单镜用 fade 或不加；同种转场每片 ≤2 次，多了显廉价。

## 4 个能力，按需直接调用

你做的事可归为 4 个**能力**（capabilities，无固定先后）：**research**（趋势 / 对标 / 已有素材——\`autoviral trends\`、\`GET /api/trends/*\`）· **planning**（把意图转成 brief，写进 plan/）· **assets**（上面的生成端点）· **assembly**（用 \`autoviral clip\` / 转场 / TTS / 字幕拼装）。任意能力都可**直接调用**，没有前置依赖、没有顺序约束、没有评审门禁。

## 思维标签（可选）
内部组织工作时你可以借用 **plan / 素材生成 / 成品** 三个思维 bucket（mental bucket）帮自己理清——这些是你的脑内分类，不是面向用户的进度条。用户随时可能跳过其中任意一个：例如他们提供了完整 brief，你应直接进 assets / assembly；他们要试一个素材想法，你也可以只跑 assets。

## 用户意图优先
- 用户说 "先看看趋势" → research 能力
- 用户说 "我已经有想法了，开始做图" → assets 能力
- 用户说 "把这两段视频拼起来加个字幕" → assembly 能力
- 用户说 "帮我捋一下叙事" → planning 能力
不要反问 "我们应该先做哪个能力"，按用户意图直接动手。

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
    ? "composition.yaml：优先用 `autoviral clip add/set/remove` 改（原子 + zod 校验 + 实时驱动 Studio）；CLI 这一期还没覆盖的字段 / clip 种类，按 `autoviral docs 02-composition-schema` 给的 schema 直接编辑 composition.yaml。"
    : "carousel.yaml（图文暂无 CLI，直接写这个绝对路径文件）：{ id, workId, width, height, globals: { headlineFont, palette, layout, effects }, slides: [{ id, bg, layers }], updatedAt }。"}
- **不要**写到相对路径 \`data/works/...\`：你的 shell cwd 是项目根而不是 workspace，相对路径会落错位置导致 frontend 看不到产物。（\`autoviral\` 命令的 \`--src\` 等路径相对 workspace root，由 CLI 解析，不受此限。）
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

- **Asset inline preview**：当你刚刚通过 OpenRouter（image / video）产出新的 asset 后，用 markdown 图片语法 \`![alt](path)\` 把它嵌进回复——前端会在 chat 里直接 render 成可见的缩略图（视频会自动用 \`<video>\` 渲染，含 controls）。
  - path 用相对 work 目录的 \`assets/images/foo.png\` 或 \`assets/clips/bar.mp4\` 即可，前端会自动 resolve 到 \`/api/works/<id>/assets/...\`
  - 例："已生成第 3 张候选： ![v3](assets/images/v3.png)"——用户在 chat 里直接看图，不用切到 asset library。

## 用户附件
用户可能给消息附带**图片 / 视频 / 音频**。它们以下面这种 envelope 出现在消息开头（前端自动加的，用户气泡里看到的是缩略图）：
\`\`\`
<attachments>
  <file path="assets/images/ref.png" type="image" name="ref.png" />
</attachments>
\`\`\`
- 文件**已经上传**到本作品的 assets/ 目录。\`path\` 是相对 workspace root 的；你的 shell cwd 是项目根**不是** workspace，所以 Read 时要用绝对路径 **\`${workspacePath}/<path>\`**（例：\`${workspacePath}/assets/images/ref.png\`）。
- **要"看到"图片就用 Read 工具读那个绝对路径**——图片会直接呈现给你。比如用户附了张参考图，先 Read 看清楚，再决定怎么用它驱动 i2v / 定风格 / 调色。
- 这些附件同时已经是作品的正式 asset（在素材库可见），可直接作为 \`clip add --src <path>\` / image-to-video 的 first_frame 等使用，无需重新生成。

## 风格约束
- 中文优先；技术名词保留英文
- 不向用户复述"我在做哪一步 / 哪个能力"——直接给结果，或问具体问题
- 不输出暗示固定顺序的 progression 词汇
- 任何交付前对照你加载的 editorial-taste sibling skill 的 rubric 自评；AutoViral 工位本身不内置审美评分

完成本轮工作后，把最终产物写入 ${deliverableAbs}（其它中间产物落对应子目录），然后用一句话告诉用户做了什么、看哪里。`;
}

const VIEWER_CONTEXT_BLOCK_RX = /^<viewer-context[\s\S]*?<\/viewer-context>\s*/;
const ATTACHMENTS_BLOCK_RX = /^<attachments>[\s\S]*?<\/attachments>\s*/;
const ATTACH_FILE_RX = /<file\s+path="([^"]*)"\s+type="([^"]*)"\s+name="([^"]*)"\s*\/>/g;

function unescapeXmlAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/**
 * Split a wire message (the envelope-prefixed text the frontend sends) into the
 * clean user text + structured attachments. The agent still receives the FULL
 * wire text — it needs the <viewer-context>/<attachments> envelopes — but what
 * we PERSIST and show in the user bubble is the clean version, so a reloaded
 * chat renders clean text + attachment thumbnails instead of raw envelope XML.
 * Attachment `url` is the workspace-relative path; the browser's resolveAssetUrl
 * turns it into a served URL. Dedups by path.
 */
export function splitUserWireText(wireText: string, workId: string): { text: string; attachments?: ChatBlockAttachment[] } {
  let rest = wireText;
  const attachments: ChatBlockAttachment[] = [];
  const seen = new Set<string>();
  // Leading envelopes are "\n\n"-joined in either order — strip until neither
  // matches (guard bounds the loop against a pathological input).
  for (let guard = 0; guard < 8; guard++) {
    const vc = rest.match(VIEWER_CONTEXT_BLOCK_RX);
    if (vc) {
      rest = rest.slice(vc[0].length);
      continue;
    }
    const at = rest.match(ATTACHMENTS_BLOCK_RX);
    if (at) {
      ATTACH_FILE_RX.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ATTACH_FILE_RX.exec(at[0]))) {
        const path = m[1];
        if (seen.has(path)) continue;
        seen.add(path);
        // Store the fully-served URL — IDENTICAL to the live upload path's
        // r.url — so the bubble's resolveAssetUrl passes it straight through on
        // reload. Storing the bare relative "assets/…" path instead made the
        // resolver re-prefix it to /assets/assets/… → a 404'd broken thumbnail.
        const url = `/api/works/${workId}/${path}`;
        attachments.push({ path, url, name: unescapeXmlAttr(m[3]), kind: m[2] });
      }
      rest = rest.slice(at[0].length);
      continue;
    }
    break;
  }
  return { text: rest.replace(/^\s+/, ""), attachments: attachments.length ? attachments : undefined };
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
  /** Backend HTTP port — injected into the agent env as AUTOVIRAL_PORT so the
   *  `autoviral` CLI (and any direct fetch) can reach this daemon. */
  private readonly serverPort: number;

  constructor(serverPort: number) {
    this.serverPort = serverPort;
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
    // Persist/display the CLEAN user text + structured attachments — the agent
    // already got the full envelope-prefixed wire text at spawn time.
    const { text: displayText, attachments } = splitUserWireText(text, workId);
    const userBlock: ChatBlock = {
      type: "user",
      text: displayText,
      ...(attachments ? { attachments } : {}),
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

    // Persist/display the CLEAN user text + structured attachments — spawnCli
    // below still gets the full envelope-prefixed `text` (the agent needs it).
    const { text: displayText, attachments } = splitUserWireText(text, workId);
    const userBlock: ChatBlock = {
      type: "user",
      text: displayText,
      ...(attachments ? { attachments } : {}),
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

    // Put the `autoviral` CLI on the agent's PATH (repo-contained shim — no
    // global `npm link`) and inject the per-work env the CLI requires. Without
    // this the skill documents a CLI the agent can't run: `autoviral` would be
    // `command not found`, and even resolved it exits 2 on a missing
    // AUTOVIRAL_WORK_ID. AUTOVIRAL_PORT is already set process-wide in
    // startServer(), but we set it explicitly here to stay self-contained.
    // Anchor on PACKAGE_ROOT (not process.cwd()) — in a packaged Electron app
    // the working dir is not the repo checkout, so the repo-contained shim dir
    // and AUTOVIRAL_PROJECT_DIR must resolve from the bundled package root.
    const cliBinDir = join(PACKAGE_ROOT, "cli", "autoviral", "bin");
    const workCwd = join(dataDir, "works", session.workId);
    const proc = spawn("claude", args, {
      cwd: PACKAGE_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${cliBinDir}:${process.env.PATH ?? ""}`,
        CLAUDE_CODE_ENTRYPOINT: "cli",
        AUTOVIRAL_PROJECT_DIR: PACKAGE_ROOT,
        AUTOVIRAL_WORK_ID: session.workId,
        AUTOVIRAL_PORT: String(this.serverPort),
        AUTOVIRAL_CWD: workCwd,
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
      // A packaged Electron app inherits a minimal GUI PATH that often does
      // NOT include the `claude` binary, so spawn() fails with ENOENT. Surface
      // a clear, actionable message instead of a cryptic spawn error — and
      // never let it crash the daemon (this handler swallows it).
      session.cliProcess = undefined;
      session.idle = true;
      const isNotFound = (err as NodeJS.ErrnoException).code === "ENOENT";
      const message = isNotFound
        ? "无法启动创作 agent：找不到 `claude` 命令。请确认 Claude Code CLI 已安装并在 PATH 上（在终端运行 `claude --version` 验证）。"
        : `创作 agent 启动失败：${err.message}`;
      logBridge("cli_spawn_error", session.workId, {
        code: (err as NodeJS.ErrnoException).code,
        message: err.message,
      });
      this.broadcastToBrowsers(session.workId, {
        event: "cli_error",
        data: { workId: session.workId, error: message, code: (err as NodeJS.ErrnoException).code },
      });
      if (session.workId.startsWith("trends_")) {
        this.broadcastToBrowsers(session.workId, {
          event: "research_error",
          data: { message },
        });
      }
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

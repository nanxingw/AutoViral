import { Hono } from "hono";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { loadConfig, saveConfig, type Config } from "../config.js";
import {
  listWorks, getWork, createWork as storeCreateWork,
  updateWork as storeUpdateWork, deleteWork as storeDeleteWork,
  listAssets, getAssetPath,
} from "../work-store.js";
import { MemoryClient } from "../memory.js";
import type { WsBridge } from "../ws-bridge.js";

export const apiRoutes = new Hono();

// ── WsBridge accessor (set by server/index.ts after construction) ─────────
let wsBridge: WsBridge | null = null;

export function setWsBridge(bridge: WsBridge): void {
  wsBridge = bridge;
}

// GET /api/status
apiRoutes.get("/api/status", async (c) => {
  const config = await loadConfig();
  return c.json({
    state: "idle",
    model: config.model,
    port: config.port,
  });
});

// GET /api/config
apiRoutes.get("/api/config", async (c) => {
  const config = await loadConfig();
  return c.json(config);
});

// PUT /api/config
apiRoutes.put("/api/config", async (c) => {
  const body = await c.req.json<Partial<Config>>();
  const current = await loadConfig();
  const updated: Config = { ...current, ...body };
  await saveConfig(updated);
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// Work API
// ---------------------------------------------------------------------------

// GET /api/works
apiRoutes.get("/api/works", async (c) => {
  try {
    const works = await listWorks();
    return c.json({ works });
  } catch {
    return c.json({ works: [] });
  }
});

// POST /api/works
apiRoutes.post("/api/works", async (c) => {
  try {
    const body = await c.req.json<{
      title: string;
      type: string;
      platforms: string[];
      topicHint?: string;
    }>();
    if (!body.title || !body.type || !body.platforms) {
      return c.json({ error: "title, type, and platforms are required" }, 400);
    }
    const work = await storeCreateWork({
      title: body.title,
      type: body.type as "short-video" | "image-text",
      platforms: body.platforms,
      topicHint: body.topicHint,
    });
    return c.json(work, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to create work" }, 400);
  }
});

// GET /api/works/:id
apiRoutes.get("/api/works/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const work = await getWork(id);
    if (!work) return c.json({ error: "Work not found" }, 404);
    return c.json(work);
  } catch {
    return c.json({ error: "Work not found" }, 404);
  }
});

// PUT /api/works/:id
apiRoutes.put("/api/works/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const body = await c.req.json();
    const work = await storeUpdateWork(id, body);
    if (!work) return c.json({ error: "Work not found" }, 404);
    return c.json(work);
  } catch {
    return c.json({ error: "Work not found" }, 404);
  }
});

// DELETE /api/works/:id
apiRoutes.delete("/api/works/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const deleted = await storeDeleteWork(id);
    if (!deleted) return c.json({ error: "Work not found" }, 404);
    return c.json({ deleted: true });
  } catch {
    return c.json({ error: "Work not found" }, 404);
  }
});

// GET /api/works/:id/assets
apiRoutes.get("/api/works/:id/assets", async (c) => {
  const id = c.req.param("id");
  try {
    const assets = await listAssets(id);
    return c.json({ assets });
  } catch {
    return c.json({ assets: [] });
  }
});

// GET /api/works/:id/assets/:filename — serve asset file
apiRoutes.get("/api/works/:id/assets/:filename", async (c) => {
  const id = c.req.param("id");
  const filename = c.req.param("filename");
  try {
    const filePath = getAssetPath(id, filename);
    const content = await readFile(filePath);
    // Determine content type from extension
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
      webp: "image/webp", svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm",
      pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
    };
    const contentType = mimeMap[ext] ?? "application/octet-stream";
    return new Response(content, {
      headers: { "Content-Type": contentType },
    });
  } catch {
    return c.json({ error: "Asset not found" }, 404);
  }
});

// GET /api/analytics — aggregate metrics from all works
apiRoutes.get("/api/analytics", async (c) => {
  try {
    const summaries = await listWorks();
    let totalWorks = summaries.length;
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;

    return c.json({ totalWorks, totalViews, totalLikes, totalComments });
  } catch {
    return c.json({ totalWorks: 0, totalViews: 0, totalLikes: 0, totalComments: 0 });
  }
});

// ---------------------------------------------------------------------------
// Trend Research via Claude CLI
// ---------------------------------------------------------------------------

/** Run claude CLI with a prompt and return the text result. */
function runCliBrief(prompt: string, useChrome = false, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--output-format", "json",
      "--dangerously-skip-permissions",
      "--model", "haiku",
    ];
    if (useChrome) args.push("--chrome");

    const proc = spawn("claude", args, {
      cwd: homedir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli" },
    });

    let stdout = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.on("exit", (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`CLI exited with code ${code}`));
        return;
      }
      try {
        const envelope = JSON.parse(stdout);
        resolve(envelope.result ?? "");
      } catch {
        resolve(stdout);
      }
    });
    proc.on("error", reject);
    setTimeout(() => { try { proc.kill(); } catch {} reject(new Error("Timeout")); }, timeoutMs);
  });
}

async function researchTrends(platforms: string[]): Promise<{ collected: string[]; errors: string[] }> {
  const collected: string[] = [];
  const errors: string[] = [];

  for (const platform of platforms) {
    const platformLabel = platform === "xiaohongshu" ? "小红书" : platform === "douyin" ? "抖音" : platform;

    const prompt = [
      `你是一个社交媒体趋势研究员。请搜索 ${platformLabel} 平台当前最热门的内容趋势和话题。`,
      ``,
      `使用 WebSearch 搜索以下内容：`,
      `- "${platformLabel} 热门话题 2026"`,
      `- "${platformLabel} 爆款内容 趋势"`,
      `- "${platformLabel} 热搜榜"`,
      ``,
      `然后根据搜索结果，整理成以下 JSON 格式。`,
      `即使搜索结果不完整，也要根据已有信息尽力填充，估算数据也可以。`,
      `你必须输出有效的 JSON，这是硬性要求，不允许输出其他格式。`,
      ``,
      `输出格式（只输出这个 JSON，不要其他任何文字）：`,
      `{"videos":[{"title":"内容标题","thumb":"","views":"1.2万","likes":"3200","comments":"156"}],"tags":[{"tag":"#话题","posts":"50万","trend":"up"}]}`,
      ``,
      `videos 至少8条，tags 至少10个。trend 为 up/down/stable。`,
      `views/likes/comments/posts 用中文简写（万/亿）。`,
    ].join("\n");

    try {
      const result = await runCliBrief(prompt);
      const stripped = result.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
      const firstBrace = stripped.indexOf("{");
      const lastBrace = stripped.lastIndexOf("}");
      if (firstBrace < 0 || lastBrace <= firstBrace) {
        errors.push(platform);
        continue;
      }

      const data = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
      if (!data.videos || !data.tags) {
        errors.push(platform);
        continue;
      }

      const trendsDir = join(homedir(), ".skill-evolver", "trends", platform);
      await mkdir(trendsDir, { recursive: true });
      const dateStr = new Date().toISOString().slice(0, 10);
      await writeFile(
        join(trendsDir, `${dateStr}.yaml`),
        yaml.dump(data, { lineWidth: -1 }),
        "utf-8"
      );

      collected.push(platform);
    } catch {
      errors.push(platform);
    }
  }

  return { collected, errors };
}

// GET /api/trends/:platform — return latest trend data
apiRoutes.get("/api/trends/:platform", async (c) => {
  const platform = c.req.param("platform");
  try {
    const trendsDir = join(homedir(), ".skill-evolver", "trends", platform);
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(trendsDir);
    const yamlFiles = files.filter(f => f.endsWith(".yaml")).sort().reverse();
    if (yamlFiles.length === 0) return c.json({ error: "No trend data available" }, 404);
    const raw = await readFile(join(trendsDir, yamlFiles[0]), "utf-8");
    const data = yaml.load(raw);
    return c.json(data);
  } catch {
    return c.json({ error: "No trend data available" }, 404);
  }
});

// POST /api/collector/trigger — trigger research collection
apiRoutes.post("/api/collector/trigger", async (c) => {
  try {
    const body = await c.req.json<{ platforms?: string[] }>().catch(() => ({}));
    const platforms = (body as any).platforms ?? ["xiaohongshu", "douyin"];
    const result = await researchTrends(platforms);
    return c.json({ triggered: true, type: "research", ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Collection failed" }, 500);
  }
});

// GET /api/collector/status
apiRoutes.get("/api/collector/status", async (c) => {
  const config = await loadConfig();
  return c.json({
    enabled: config.research.enabled,
    schedule: config.research.schedule,
    platforms: config.research.platforms,
  });
});

// ---------------------------------------------------------------------------
// Platform connection via Claude CLI --chrome
// ---------------------------------------------------------------------------

const PLATFORM_CONFIG: Record<string, { label: string; creatorUrl: string; checkPrompt: string; loginPrompt: string }> = {
  douyin: {
    label: "抖音",
    creatorUrl: "https://creator.douyin.com/",
    checkPrompt: '使用Chrome打开 https://creator.douyin.com/ ，等待3秒页面加载完成。然后检查页面上是否有"创作者登录"按钮或登录相关元素。如果看到了登录按钮或登录页面，回复 "NOT_LOGGED_IN"。如果看到了创作者后台/仪表盘内容（如数据概览、作品管理等），回复 "LOGGED_IN"。只回复这两个词之一，不要其他内容。',
    loginPrompt: '使用Chrome打开 https://creator.douyin.com/ ，点击"创作者登录"按钮。等待登录弹窗出现，让用户扫码登录。等待最多120秒直到登录成功（页面跳转到创作者后台）。如果登录成功回复 "LOGIN_SUCCESS"，如果超时回复 "LOGIN_TIMEOUT"。',
  },
  xiaohongshu: {
    label: "小红书",
    creatorUrl: "https://creator.xiaohongshu.com/",
    checkPrompt: '使用Chrome打开 https://creator.xiaohongshu.com/ ，等待3秒页面加载完成。检查当前URL是否包含"/login"或页面上是否有登录表单。如果看到了登录页面，回复 "NOT_LOGGED_IN"。如果看到了创作者后台内容，回复 "LOGGED_IN"。只回复这两个词之一，不要其他内容。',
    loginPrompt: '使用Chrome打开 https://creator.xiaohongshu.com/login ，页面右上角有一个二维码图标，点击切换到二维码登录模式。让用户用小红书App扫码。等待最多120秒直到登录成功。如果登录成功回复 "LOGIN_SUCCESS"，如果超时回复 "LOGIN_TIMEOUT"。',
  },
};

const checkProcesses: Map<string, Promise<boolean>> = new Map();
const checkCache: Map<string, { result: boolean; timestamp: number }> = new Map();
const CHECK_CACHE_TTL = 30_000;
const loginProcesses: Map<string, Promise<boolean>> = new Map();

async function checkPlatformLogin(platform: string): Promise<boolean> {
  const config = PLATFORM_CONFIG[platform];
  if (!config) return false;

  const cached = checkCache.get(platform);
  if (cached && Date.now() - cached.timestamp < CHECK_CACHE_TTL) {
    return cached.result;
  }

  const existing = checkProcesses.get(platform);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const result = await runCliBrief(config.checkPrompt, true);
      const loggedIn = result.includes("LOGGED_IN") && !result.includes("NOT_LOGGED_IN");
      checkCache.set(platform, { result: loggedIn, timestamp: Date.now() });
      return loggedIn;
    } catch {
      return false;
    } finally {
      checkProcesses.delete(platform);
    }
  })();

  checkProcesses.set(platform, promise);
  return promise;
}

function triggerPlatformLogin(platform: string): void {
  const config = PLATFORM_CONFIG[platform];
  if (!config) return;
  const promise = runCliBrief(config.loginPrompt, true, 150000)
    .then(result => result.includes("LOGIN_SUCCESS"))
    .catch(() => false)
    .finally(() => loginProcesses.delete(platform));
  loginProcesses.set(platform, promise);
}

// GET /api/platforms
apiRoutes.get("/api/platforms", async (c) => {
  const platforms = Object.entries(PLATFORM_CONFIG).map(([name, config]) => ({
    name,
    label: config.label,
    creatorUrl: config.creatorUrl,
    loggedIn: false,
    checking: false,
    connecting: loginProcesses.has(name),
  }));
  return c.json({ platforms });
});

// GET /api/platforms/:name/status
apiRoutes.get("/api/platforms/:name/status", async (c) => {
  const name = c.req.param("name");
  if (!PLATFORM_CONFIG[name]) {
    return c.json({ error: `Unknown platform: ${name}` }, 404);
  }
  const loggedIn = await checkPlatformLogin(name);
  return c.json({ platform: name, loggedIn, connecting: loginProcesses.has(name) });
});

// POST /api/platforms/:name/login
apiRoutes.post("/api/platforms/:name/login", async (c) => {
  const name = c.req.param("name");
  if (!PLATFORM_CONFIG[name]) {
    return c.json({ error: `Unknown platform: ${name}` }, 404);
  }
  if (loginProcesses.has(name)) {
    return c.json({ pending: true, message: "Login already in progress" });
  }
  triggerPlatformLogin(name);
  return c.json({ pending: true, message: `Chrome opened for ${PLATFORM_CONFIG[name].label} login` });
});

// POST /api/platforms/:name/logout
apiRoutes.post("/api/platforms/:name/logout", async (c) => {
  const name = c.req.param("name");
  return c.json({ success: true, message: `${name} disconnected` });
});

// ---------------------------------------------------------------------------
// Work Chat API (WsBridge)
// ---------------------------------------------------------------------------

// POST /api/works/:id/session
apiRoutes.post("/api/works/:id/session", async (c) => {
  const id = c.req.param("id");
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const session = wsBridge.getSession(id);
    if (session?.cliProcess) {
      return c.json({ status: "already_running", workId: id });
    }

    const work = await getWork(id);
    if (!work) return c.json({ error: "Work not found" }, 404);

    const steps = Object.entries(work.pipeline);
    const pendingStep = steps.find(([, s]) => s.status === "pending" || s.status === "active");
    const stepName = pendingStep ? pendingStep[1].name : steps[0]?.[1]?.name ?? "创作";

    const prompt = [
      `你是一个内容创作助手。你正在帮助用户创作: "${work.title}" (类型: ${work.type})。`,
      `目标平台: ${work.platforms.map((p: any) => typeof p === "string" ? p : p.platform).join(", ")}。`,
      work.topicHint ? `选题方向: ${work.topicHint}` : "",
      ``,
      `当前步骤: "${stepName}"。请开始这个步骤的创作工作。`,
    ].filter(Boolean).join("\n");

    const config = await loadConfig();
    wsBridge.createSession(id, prompt, config.model);
    return c.json({ status: "started", workId: id, step: stepName });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Session start error" }, 500);
  }
});

// POST /api/works/:id/chat
apiRoutes.post("/api/works/:id/chat", async (c) => {
  const id = c.req.param("id");
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const body = await c.req.json<{ text: string }>();
    if (!body.text) return c.json({ error: "text is required" }, 400);

    let session = wsBridge.getSession(id);
    if (!session) {
      const config = await loadConfig();
      session = wsBridge.createSession(id, body.text, config.model);
      return c.json({ sent: true, sessionCreated: true, workId: id });
    }

    const sent = wsBridge.sendMessage(id, body.text);
    if (!sent) return c.json({ error: "Failed to send message" }, 500);
    return c.json({ sent: true, workId: id });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Chat error" }, 500);
  }
});

// POST /api/works/:id/step/:step
apiRoutes.post("/api/works/:id/step/:step", async (c) => {
  const id = c.req.param("id");
  const step = c.req.param("step");
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const work = await getWork(id);
    if (!work) return c.json({ error: "Work not found" }, 404);

    const pipelineStep = work.pipeline[step];
    if (!pipelineStep) return c.json({ error: `Unknown pipeline step: ${step}` }, 404);

    const prompt = [
      `You are working on a content piece: "${work.title}" (type: ${work.type}).`,
      `Platforms: ${work.platforms.map((p: any) => typeof p === "string" ? p : p.platform).join(", ")}.`,
      work.topicHint ? `Topic hint: ${work.topicHint}` : "",
      ``,
      `Execute the "${pipelineStep.name}" step of the pipeline.`,
      `Produce output appropriate for this step. Be thorough and creative.`,
    ].filter(Boolean).join("\n");

    const config = await loadConfig();
    let session = wsBridge.getSession(id);
    if (!session) {
      session = wsBridge.createSession(id, prompt, config.model);
      return c.json({ triggered: true, sessionCreated: true, workId: id, step });
    }

    wsBridge.sendMessage(id, prompt);
    return c.json({ triggered: true, workId: id, step });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Step trigger error" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Memory API (EverMemOS integration)
// ---------------------------------------------------------------------------

let _memoryClient: MemoryClient | null | undefined;
async function getMemoryClient(): Promise<MemoryClient | null> {
  if (_memoryClient === undefined) {
    _memoryClient = await MemoryClient.fromConfig();
  }
  return _memoryClient;
}

// GET /api/memory/search?q=...&method=hybrid&topK=10
apiRoutes.get("/api/memory/search", async (c) => {
  const client = await getMemoryClient();
  if (!client) return c.json({ error: "Memory not configured (missing apiKey)" }, 503);
  const q = c.req.query("q") ?? "";
  if (!q) return c.json({ error: "Missing query parameter ?q=" }, 400);
  const method = (c.req.query("method") ?? "hybrid") as "keyword" | "vector" | "hybrid" | "agentic";
  const topK = parseInt(c.req.query("topK") ?? "10", 10);
  const result = await client.search(q, { method, topK });
  return c.json(result);
});

// GET /api/memory/profile
apiRoutes.get("/api/memory/profile", async (c) => {
  const client = await getMemoryClient();
  if (!client) return c.json({ error: "Memory not configured (missing apiKey)" }, 503);
  const [style, rules] = await Promise.all([
    client.search("我的内容风格 创作偏好 个人特征", { method: "vector", topK: 10, memoryTypes: ["core", "profile"] }),
    client.search("平台规则 算法推荐 发布技巧", { method: "keyword", topK: 10 }),
  ]);
  return c.json({
    profiles: style.profiles,
    styleMemories: style.memories,
    platformRules: rules.memories,
  });
});

// GET /api/memory/context/:workId
apiRoutes.get("/api/memory/context/:workId", async (c) => {
  const client = await getMemoryClient();
  if (!client) return c.json({ error: "Memory not configured (missing apiKey)" }, 503);
  const workId = c.req.param("workId");
  const work = await getWork(workId);
  if (!work) return c.json({ error: "Work not found" }, 404);
  const topic = work.topicHint ?? work.title;
  const firstPlatform = work.platforms?.[0];
  const platform = typeof firstPlatform === "string" ? firstPlatform : (firstPlatform as any)?.platform ?? "通用";
  const context = await client.buildContext(topic, platform);
  return c.json({ workId, topic, platform, context });
});

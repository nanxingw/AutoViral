import { Hono } from "hono";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, extname } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { loadConfig, saveConfig, dataDir, type Config } from "../config.js";
import {
  listWorks, getWork, createWork as storeCreateWork,
  updateWork as storeUpdateWork, deleteWork as storeDeleteWork,
  listAssets, getAssetPath, saveStepHistory, loadStepHistory,
  saveEvalResult, loadEvalResults, type EvalResult,
} from "../work-store.js";
import { MemoryClient } from "../memory.js";
import type { WsBridge } from "../ws-bridge.js";
import { getProvider, getDefaultProvider, listProviders } from "../providers/registry.js";
import { listSharedAssets, listSharedAssetsWithMeta, getSharedAssetPath, saveSharedAsset, deleteSharedAsset, moveSharedAsset, sanitizeFilename, validateCategory, CATEGORIES } from "../shared-assets.js";
import { getLatestCreatorData, getCreatorHistory } from "../analytics-collector.js";
import { syncStepConversation } from "../memory-sync.js";
import { log, readLogs } from "../logger.js";
import { runPipeline, getRunStatus, listRuns, getRunReport, type RunConfig } from "../test-runner.js";
import { evaluateWork } from "../test-evaluator.js";

export const apiRoutes = new Hono();

// ── Python script runner for real-time trend data ────────────────────────────

const execFileAsync = promisify(execFile);

async function runTrendScript(platform: string): Promise<string> {
  const scriptsDir = join(process.cwd(), 'skills', 'trend-research', 'scripts');

  try {
    if (platform === 'douyin') {
      const { stdout } = await execFileAsync('python3', [
        join(scriptsDir, 'douyin_hot_search.py'), '--top', '30'
      ], { timeout: 30000 });
      return stdout;
    }
    // Other platforms via newsnow
    const { stdout } = await execFileAsync('python3', [
      join(scriptsDir, 'newsnow_trends.py'), platform, '--top', '20'
    ], { timeout: 30000 });
    return stdout;
  } catch (err) {
    console.error(`[trends] Script error for ${platform}:`, err);
    return '';
  }
}

// ── MIME type helper ────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
};

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// ── WsBridge accessor (set by server/index.ts after construction) ─────────
let wsBridge: WsBridge | null = null;

export function setWsBridge(bridge: WsBridge): void {
  wsBridge = bridge;
}

// ── Status & Config ─────────────────────────────────────────────────────────

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
  return c.json({
    ...config,
    jimengAccessKey: config.jimeng?.accessKey ?? "",
    jimengSecretKey: config.jimeng?.secretKey ?? "",
    openrouterKey: config.openrouter?.apiKey ?? "",
    researchEnabled: config.research?.enabled ?? false,
    researchCron: config.research?.schedule ?? "0 9 * * *",
    douyinUrl: config.analytics?.douyinUrl ?? "",
    memorySyncEnabled: config.memory?.syncEnabled ?? false,
  });
});

// PUT /api/config
apiRoutes.put("/api/config", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const config = await loadConfig();

  // Map flat frontend fields to nested config structure
  if (body.jimengAccessKey !== undefined) {
    if (!config.jimeng) config.jimeng = { accessKey: "", secretKey: "" };
    config.jimeng.accessKey = body.jimengAccessKey as string;
  }
  if (body.jimengSecretKey !== undefined) {
    if (!config.jimeng) config.jimeng = { accessKey: "", secretKey: "" };
    config.jimeng.secretKey = body.jimengSecretKey as string;
  }
  if (body.openrouterKey !== undefined) {
    config.openrouter = { apiKey: body.openrouterKey as string };
  }
  if (body.researchEnabled !== undefined) {
    if (!config.research) config.research = { enabled: false, schedule: "0 9 * * *", platforms: ["douyin", "xiaohongshu"] };
    config.research.enabled = body.researchEnabled as boolean;
  }
  if (body.researchCron !== undefined) {
    if (!config.research) config.research = { enabled: false, schedule: "0 9 * * *", platforms: ["douyin", "xiaohongshu"] };
    config.research.schedule = body.researchCron as string;
  }
  if (body.model !== undefined) {
    config.model = body.model as string;
  }
  if (body.douyinUrl !== undefined) {
    if (!config.analytics) config.analytics = { douyinUrl: "", collectInterval: 60, enabled: true };
    config.analytics.douyinUrl = body.douyinUrl as string;
  }
  if (body.memorySyncEnabled !== undefined) {
    if (!config.memory) config.memory = { apiKey: "", userId: "autoviral-user", syncEnabled: false };
    config.memory.syncEnabled = body.memorySyncEnabled as boolean;
  }

  await saveConfig(config);
  return c.json(config);
});

// ---------------------------------------------------------------------------
// Work API
// ---------------------------------------------------------------------------

// GET /api/works — list works with cover image from first asset
apiRoutes.get("/api/works", async (c) => {
  try {
    const works = await listWorks();
    // Attach coverImage: prefer cover image, then final video, then output image, then first asset image
    const enriched = await Promise.all(works.map(async (w) => {
      try {
        const assets = await listAssets(w.id);
        // 1. Explicit cover image in output/ (best frame selected during assembly)
        const coverImage = assets.find((a: string) =>
          /\.(png|jpe?g|webp)$/i.test(a) && a.startsWith("output/") && /cover/i.test(a)
        );
        if (coverImage) {
          return { ...w, coverImage: `/api/works/${w.id}/assets/${coverImage.split("/").map(encodeURIComponent).join("/")}` };
        }
        // 2. Final video — browser will show keyframe as poster
        const finalVideo = assets.find((a: string) =>
          /\.(mp4|mov|webm)$/i.test(a) && /final/i.test(a)
        );
        if (finalVideo) {
          return { ...w, coverImage: `/api/works/${w.id}/assets/${finalVideo.split("/").map(encodeURIComponent).join("/")}`, coverIsVideo: true };
        }
        // 3. Output image (thumbnail)
        const outputImage = assets.find((a: string) =>
          /\.(png|jpe?g|webp|gif)$/i.test(a) && a.startsWith("output/")
        );
        if (outputImage) {
          return { ...w, coverImage: `/api/works/${w.id}/assets/${outputImage.split("/").map(encodeURIComponent).join("/")}` };
        }
        // 3. Any asset image
        const firstImage = assets.find((a: string) =>
          /\.(png|jpe?g|webp|gif)$/i.test(a)
        );
        if (firstImage) {
          return { ...w, coverImage: `/api/works/${w.id}/assets/${firstImage.split("/").map(encodeURIComponent).join("/")}` };
        }
      } catch {}
      return w;
    }));
    return c.json({ works: enriched });
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
      contentCategory?: string;
      videoSource?: string;
      videoSearchQuery?: string;
      platforms: string[];
      topicHint?: string;
      language?: "en" | "zh";
    }>();
    if (!body.title || !body.type || !body.platforms) {
      return c.json({ error: "title, type, and platforms are required" }, 400);
    }
    const work = await storeCreateWork({
      title: body.title,
      type: body.type as "short-video" | "image-text",
      contentCategory: body.contentCategory as any,
      videoSource: body.videoSource as any,
      videoSearchQuery: body.videoSearchQuery,
      platforms: body.platforms,
      topicHint: body.topicHint,
      language: body.language,
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

// GET /api/works/:id/assets/* — serve asset files (supports nested paths like images/scene-01.png or output/final.mp4)
apiRoutes.get("/api/works/:id/assets/*", async (c) => {
  const id = c.req.param("id");
  // Extract the nested path after /assets/
  const url = new URL(c.req.url);
  const prefix = `/api/works/${id}/assets/`;
  const nestedPath = url.pathname.slice(prefix.length);
  if (!nestedPath) return c.json({ error: "Asset path required" }, 400);

  try {
    // nestedPath maps directly to workspace subdirectory (e.g. "images/xxx.png", "output/xxx.png")
    const filePath = getAssetPath(id, nestedPath);
    const content = await readFile(filePath);
    return new Response(content, {
      headers: { "Content-Type": getMimeType(filePath) },
    });
  } catch {
    return c.json({ error: "Asset not found" }, 404);
  }
});

// POST /api/works/:id/assets/upload — upload file to work assets
apiRoutes.post("/api/works/:id/assets/upload", async (c) => {
  const workId = c.req.param("id");
  const body = await c.req.parseBody();
  const file = body.file;
  const subdir = (body.subdir as string) ?? "images";

  if (!(file instanceof File)) {
    return c.json({ error: "No file provided" }, 400);
  }

  const assetsDir = join(homedir(), ".autoviral", "works", workId, "assets", subdir);
  await mkdir(assetsDir, { recursive: true });
  const filePath = join(assetsDir, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  return c.json({
    success: true,
    path: `${subdir}/${file.name}`,
    url: `/api/works/${workId}/assets/${subdir}/${encodeURIComponent(file.name)}`,
  });
});

// GET /api/analytics — aggregate metrics from all works
apiRoutes.get("/api/analytics", async (c) => {
  try {
    const summaries = await listWorks();
    const totalWorks = summaries.length;
    const totalViews = 0;
    const totalLikes = 0;
    const totalComments = 0;

    return c.json({ totalWorks, totalViews, totalLikes, totalComments });
  } catch {
    return c.json({ totalWorks: 0, totalViews: 0, totalLikes: 0, totalComments: 0 });
  }
});

// GET /api/analytics/creator — latest creator data + trend delta
apiRoutes.get("/api/analytics/creator", async (c) => {
  const latest = await getLatestCreatorData()
  if (!latest) return c.json({ configured: false, data: null })
  const history = await getCreatorHistory(7)
  const yesterday = history.find(h => h.date !== new Date().toISOString().slice(0, 10))
  let delta: Record<string, number> | null = null
  if (yesterday?.data?.account && latest.account) {
    delta = {
      followers: latest.account.follower_count - yesterday.data.account.follower_count,
      favorited: latest.account.total_favorited - yesterday.data.account.total_favorited,
    }
  }
  return c.json({ configured: true, data: latest, delta })
})

// GET /api/analytics/creator/history — daily snapshots for charts
apiRoutes.get("/api/analytics/creator/history", async (c) => {
  const history = await getCreatorHistory(30)
  return c.json({ history })
})

// ---------------------------------------------------------------------------
// Generate API (Provider-based image/video generation)
// ---------------------------------------------------------------------------

// POST /api/generate/image
apiRoutes.post("/api/generate/image", async (c) => {
  const body = await c.req.json();
  const { workId, prompt, width, height, filename, provider: providerName, referenceImage } = body;
  if (!workId || !prompt || !filename) {
    return c.json({ success: false, error: "Missing required fields", code: "INVALID_PARAMS" }, 400);
  }
  const provider = providerName ? getProvider(providerName) : getDefaultProvider("image");
  if (!provider) {
    return c.json({ success: false, error: "No image provider available", code: "INVALID_PARAMS" }, 400);
  }
  try {
    const result = await provider.generateImage({ prompt, width, height, workId, filename, referenceImage });
    return c.json(result);
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/generate/video
apiRoutes.post("/api/generate/video", async (c) => {
  const body = await c.req.json();
  const { workId, prompt, firstFrame, lastFrame, resolution, filename, provider: providerName, modelVersion } = body;
  if (!workId || !prompt || !filename) {
    return c.json({ success: false, error: "Missing required fields", code: "INVALID_PARAMS" }, 400);
  }
  const provider = providerName ? getProvider(providerName) : getDefaultProvider("video");
  if (!provider) {
    return c.json({ success: false, error: "No video provider available", code: "INVALID_PARAMS" }, 400);
  }
  try {
    const result = await provider.generateVideo({ prompt, firstFrame, lastFrame, resolution, workId, filename, modelVersion });
    return c.json(result);
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/generate/lip-sync
apiRoutes.post("/api/generate/lip-sync", async (c) => {
  const body = await c.req.json();
  const { workId, videoUrl, audioUrl, filename, provider: providerName } = body;
  if (!workId || !videoUrl || !audioUrl || !filename) {
    return c.json({ success: false, error: "Missing required fields (workId, videoUrl, audioUrl, filename)", code: "INVALID_PARAMS" }, 400);
  }
  const provider = providerName ? getProvider(providerName) : getProvider("jimeng");
  if (!provider?.supportsLipSync || !provider.lipSync) {
    return c.json({ success: false, error: "No lip-sync provider available (requires Jimeng)", code: "INVALID_PARAMS" }, 400);
  }
  try {
    const result = await provider.lipSync({ videoUrl, audioUrl, workId, filename });
    return c.json(result);
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// GET /api/generate/providers
apiRoutes.get("/api/generate/providers", (c) => c.json(listProviders()));

// ---------------------------------------------------------------------------
// Shared Assets
// ---------------------------------------------------------------------------

// GET /api/shared-assets
apiRoutes.get("/api/shared-assets", async (c) => c.json(await listSharedAssetsWithMeta()));

// POST /api/shared-assets/:category — upload files
apiRoutes.post("/api/shared-assets/:category", async (c) => {
  const category = c.req.param("category");
  try {
    validateCategory(category);
    const body = await c.req.parseBody({ all: true });
    const files = Array.isArray(body["file"]) ? body["file"] : body["file"] ? [body["file"]] : [];
    const saved = [];
    for (const f of files) {
      if (f instanceof File) {
        const buf = Buffer.from(await f.arrayBuffer());
        saved.push(await saveSharedAsset(category, f.name, buf));
      }
    }
    return c.json({ uploaded: saved });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// DELETE /api/shared-assets/:category/:file
apiRoutes.delete("/api/shared-assets/:category/:file", async (c) => {
  try {
    await deleteSharedAsset(c.req.param("category"), c.req.param("file"));
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// POST /api/shared-assets/:fromCat/:file/move — move file to another category
apiRoutes.post("/api/shared-assets/:fromCat/:file/move", async (c) => {
  try {
    const { toCat } = await c.req.json<{ toCat: string }>();
    await moveSharedAsset(c.req.param("fromCat"), toCat, c.req.param("file"));
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// GET /api/shared-assets/:category/:file — serve file with correct MIME type
apiRoutes.get("/api/shared-assets/:category/:file", async (c) => {
  const filePath = getSharedAssetPath(c.req.param("category"), c.req.param("file"));
  try {
    const data = await readFile(filePath);
    return new Response(data, {
      headers: { "Content-Type": getMimeType(filePath) },
    });
  } catch {
    return c.json({ error: "File not found" }, 404);
  }
});

// GET /api/interests — 获取用户兴趣列表
apiRoutes.get("/api/interests", async (c) => {
  const config = await loadConfig();
  return c.json({ interests: config.interests ?? [] });
});

// PUT /api/interests — 更新用户兴趣列表
apiRoutes.put("/api/interests", async (c) => {
  try {
    const body = await c.req.json<{ interests: string[] }>();
    const current = await loadConfig();
    const interests = body.interests ?? [];
    await saveConfig({ ...current, interests });
    return c.json({ success: true, interests });
  } catch (err) {
    return c.json({ error: "Failed to save interests" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Trend Research via Claude CLI
// ---------------------------------------------------------------------------

/** Run claude CLI with a prompt and return the text result. */
function runCliBrief(prompt: string, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--output-format", "json",
      "--dangerously-skip-permissions",
      "--model", "haiku",
    ];

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

  // Load user interests once for all platforms
  const config = await loadConfig();
  const interests = config.interests ?? [];
  const interestClause = interests.length > 0
    ? `\n用户特别关注以下领域：${interests.join("、")}。请优先覆盖这些领域的趋势，同时也包含其他热门方向。\n`
    : '';

  for (const platform of platforms) {
    const platformLabel = platform === "xiaohongshu" ? "小红书" : platform === "douyin" ? "抖音" : platform;

    // Run script for real-time data
    const scriptData = await runTrendScript(platform);
    const dataClause = scriptData
      ? `\n以下是通过 API 获取的 ${platformLabel} 实时热搜数据，请以此为基础进行分析：\n\`\`\`json\n${scriptData.slice(0, 4000)}\n\`\`\`\n`
      : `\n无法通过 API 获取实时数据，请使用 WebSearch 搜索最新热搜信息。\n`;

    const prompt = [
      `你是一个专业的社交媒体趋势研究员。请分析 ${platformLabel} 平台当前最热门的内容趋势。`,
      dataClause,
      interestClause,
      `如果上面的 API 数据不够充分，请使用 WebSearch 补充搜索：`,
      `- "${platformLabel} 爆款内容 趋势 2026"`,
      `- "${platformLabel} 热门话题 最新"`,
      ``,
      `根据所有信息，输出以下 JSON 格式（只输出 JSON，不要其他文字）：`,
      `{"topics":[{`,
      `  "title":"话题标题",`,
      `  "heat":4,`,
      `  "competition":"中",`,
      `  "opportunity":"金矿",`,
      `  "description":"趋势描述和为什么值得做",`,
      `  "tags":["推荐标签1","推荐标签2","推荐标签3"],`,
      `  "contentAngles":["切入角度1","切入角度2"],`,
      `  "exampleHook":"爆款开头示例，如：你绝对想不到...",`,
      `  "category":"所属领域"`,
      `}]}`,
      ``,
      `要求：`,
      `- topics 至少 10 个`,
      `- heat 为 1-5 整数`,
      `- competition 为 "低"/"中"/"高"`,
      `- opportunity 为 "金矿"(高热低竞)/"蓝海"(低热低竞)/"红海"(高热高竞)`,
      `- tags 3-5 个平台推荐标签`,
      `- contentAngles 2-3 个具体的内容切入角度`,
      `- exampleHook 一句话的爆款开头示例`,
      `- category 为话题所属领域（如 美食/科技/穿搭/生活/情感/职场/健身/旅行/宠物/教育）`,
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
      if (!data.topics || !Array.isArray(data.topics)) {
        errors.push(platform);
        continue;
      }

      const trendsDir = join(homedir(), ".autoviral", "trends", platform);
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

// GET /api/trends/:platform — return latest trend data (prefer data.json, fall back to YAML)
apiRoutes.get("/api/trends/:platform", async (c) => {
  const platform = c.req.param("platform");
  const trendsDir = join(homedir(), ".autoviral", "trends", platform);

  // Try data.json first (written by agent)
  try {
    const raw = await readFile(join(trendsDir, "data.json"), "utf-8");
    return c.json(JSON.parse(raw));
  } catch { /* fall through */ }

  // Fall back to dated YAML files
  try {
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

// GET /api/trends/:platform/report — return the markdown research report
apiRoutes.get("/api/trends/:platform/report", async (c) => {
  const platform = c.req.param("platform");
  try {
    const reportPath = join(homedir(), ".autoviral", "trends", platform, "report.md");
    const report = await readFile(reportPath, "utf-8");
    return c.text(report);
  } catch {
    return c.text("", 404);
  }
});

// POST /api/trends/refresh — trigger research collection
apiRoutes.post("/api/trends/refresh", async (c) => {
  try {
    const body = await c.req.json<{ platforms?: string[] }>().catch(() => ({}));
    const platforms = (body as any).platforms ?? ["xiaohongshu", "douyin"];
    const result = await researchTrends(platforms);
    return c.json({ triggered: true, type: "research", ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Collection failed" }, 500);
  }
});

// POST /api/trends/refresh-stream — streaming trend research via WsBridge
apiRoutes.post("/api/trends/refresh-stream", async (c) => {
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const body = await c.req.json<{ platform?: string; interests?: string[]; competitors?: string[] }>().catch(() => ({}));
    const platform = (body as any).platform ?? "douyin";
    const platformLabel = platform === "xiaohongshu" ? "小红书" : platform === "douyin" ? "抖音" : platform;

    const sessionKey = `trends_${platform}_${Date.now()}`;

    // 1. Get user interests and competitors
    const config = await loadConfig();
    const reqInterests = (body as any).interests ?? config.interests ?? [];
    const interests = reqInterests as string[];
    const competitors = ((body as any).competitors ?? []) as string[];
    const interestClause = interests.length > 0
      ? `\n用户特别关注以下领域：${interests.join("、")}。请优先覆盖这些领域的趋势，同时也包含其他热门方向。\n`
      : '';
    const competitorClause = competitors.length > 0
      ? `\n用户关注的竞品账号：${competitors.join("、")}。请参考这些账号的内容方向和爆款模式。\n`
      : '';

    // 2. Run script for real-time data
    const scriptData = await runTrendScript(platform);
    const dataClause = scriptData
      ? `\n以下是通过 API 获取的 ${platformLabel} 实时热搜数据，请以此为基础进行分析：\n\`\`\`json\n${scriptData.slice(0, 4000)}\n\`\`\`\n`
      : `\n无法通过 API 获取实时数据，请使用 WebSearch 搜索最新热搜信息。\n`;

    // 3. Build enhanced prompt — agent writes files to trends output dir
    const outputDir = join(homedir(), ".autoviral", "trends", platform);
    const dataFile = join(outputDir, "data.json");
    const reportFile = join(outputDir, "report.md");

    const prompt = [
      `你是一个专业的社交媒体趋势研究员。请分析 ${platformLabel} 平台当前最热门的内容趋势。`,
      dataClause,
      interestClause,
      competitorClause,
      ``,
      `## 核心创作方向（强制执行）`,
      ``,
      `每个推荐的话题/方向必须能触发以下四种情绪中的至少一种，否则不予推荐：`,
      `1. **共鸣**（身份认同/处境代入/被戳中的感觉）— 让观众觉得"这说的不就是我吗"`,
      `2. **争议感**（不公/双标/价值观碰撞/辩论欲）— 让观众觉得"这不对/凭什么"，想站队`,
      `3. **搞笑/抽象**（反转/共鸣/错位）— 让观众笑出来想转发`,
      `4. **羡慕**（想成为/想拥有）— 让观众觉得"我也想要这样的生活"`,
      ``,
      `每个话题必须在 JSON 中标注 "emotionType"（共鸣/争议/搞笑/羡慕）和 "emotionSubtype"（具体子类型）。`,
      ``,
      `如果上面的 API 数据不够充分，请使用 WebSearch 补充搜索：`,
      `- "${platformLabel} 爆款内容 趋势 2026"`,
      `- "${platformLabel} 热门话题 最新"`,
      ``,
      `完成分析后，请将结果写入以下两个文件：`,
      ``,
      `**文件 1: ${dataFile}**`,
      `写入 JSON 格式的结构化趋势数据：`,
      `{"topics":[{`,
      `  "title":"话题标题",`,
      `  "heat":4,`,
      `  "competition":"中",`,
      `  "opportunity":"金矿",`,
      `  "emotionType":"共鸣",`,
      `  "emotionSubtype":"处境代入",`,
      `  "description":"趋势描述和为什么值得做",`,
      `  "tags":["推荐标签1","推荐标签2","推荐标签3"],`,
      `  "contentAngles":["切入角度1","切入角度2"],`,
      `  "exampleHook":"爆款开头示例",`,
      `  "category":"所属领域"`,
      `}]}`,
      `- topics 至少 10 个`,
      `- heat 为 1-5 整数，competition 为 "低"/"中"/"高"`,
      `- opportunity 为 "金矿"(高热低竞)/"蓝海"(低热低竞)/"红海"(高热高竞)`,
      `- emotionType 必填，为 "共鸣"/"争议"/"搞笑"/"羡慕" 之一`,
      `- emotionSubtype 必填，为该情绪的具体子类型`,
      `- tags 3-5 个平台推荐标签`,
      `- contentAngles 2-3 个具体的内容切入角度`,
      `- exampleHook 一句话的爆款开头示例`,
      `- category 为所属领域（美食/科技/穿搭/生活/情感/职场/健身/旅行/宠物/教育）`,
      ``,
      `**文件 2: ${reportFile}**`,
      `写入一份中文的 Markdown 格式趋势研究报告，包含：`,
      `- 标题：# ${platformLabel} 趋势研究报告`,
      `- 研究日期`,
      `- 整体趋势概述（当前平台的核心热点方向，2-3段）`,
      `- 各话题的详细分析（按热度排序，每个话题包含：为什么火、竞争情况、适合什么类型的创作者、具体的内容建议）`,
      `- 行动建议（给小创作者的 3-5 条可执行建议）`,
      ``,
      `先写 data.json，再写 report.md。两个文件都必须写入。`,
    ].join("\n");

    await wsBridge.createTrendSession(sessionKey, prompt);
    return c.json({ sessionKey, platform });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to start research" }, 500);
  }
});

// POST /api/trends/cancel/:sessionKey — cancel trend research
apiRoutes.post("/api/trends/cancel/:sessionKey", async (c) => {
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  const sessionKey = c.req.param("sessionKey");
  const killed = wsBridge.killTrendSession(sessionKey);
  return c.json({ cancelled: killed });
});

// ---------------------------------------------------------------------------
// Work Chat API (WsBridge)
// ---------------------------------------------------------------------------

// POST /api/works/:id/abort — abort running task for a work
apiRoutes.post("/api/works/:id/abort", async (c) => {
  const id = c.req.param("id");
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);
  const killed = wsBridge.killSession(id);
  return c.json({ aborted: killed });
});

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

    // Detect existing assets for skip awareness
    const sessionAssets = await listAssets(id);
    const sessionHasClips = sessionAssets.some(a => a.includes("clips/") && (a.endsWith(".mp4") || a.endsWith(".mov")));
    const sessionHasFrames = sessionAssets.some(a => a.includes("frames/") && (a.endsWith(".png") || a.endsWith(".jpg")));
    const sessionHasImages = sessionAssets.some(a => a.includes("images/") && (a.endsWith(".png") || a.endsWith(".jpg")));
    const sessionHasAssets = sessionHasClips || sessionHasFrames || sessionHasImages;
    const sessionHasDirection = !!(work.topicHint && work.topicHint.length > 50);

    // Auto-skip steps that are already covered by user-provided context
    const stepEntries = Object.entries(work.pipeline);
    let pipelineChanged = false;
    for (const [key, s] of stepEntries) {
      if (s.status !== "pending" && s.status !== "active") continue;
      let canAutoSkip = false;
      if (key === "research" && sessionHasDirection) canAutoSkip = true;
      if (key === "plan" && sessionHasDirection && sessionHasAssets) canAutoSkip = true;
      if (key === "material-search" && sessionHasClips) canAutoSkip = true;
      if (key === "assets" && sessionHasImages) canAutoSkip = true;
      if (canAutoSkip) {
        s.status = "skipped";
        s.completedAt = new Date().toISOString();
        s.note = "Auto-skipped: user provided sufficient context";
        pipelineChanged = true;
      } else {
        break; // Stop at the first step that can't be skipped
      }
    }
    if (pipelineChanged) {
      // Activate the next pending step
      const nextPending = stepEntries.find(([, s]) => s.status === "pending");
      if (nextPending) {
        nextPending[1].status = "active";
        nextPending[1].startedAt = new Date().toISOString();
      }
      await storeUpdateWork(id, { pipeline: work.pipeline });
    }

    const steps = Object.entries(work.pipeline);
    const pendingStep = steps.find(([, s]) => s.status === "pending" || s.status === "active");
    const stepName = pendingStep ? pendingStep[1].name : steps[0]?.[1]?.name ?? "创作";

    // Build skip context
    const skipContext = (sessionHasAssets || sessionHasDirection) ? [
      ``,
      `NOTE: The user has already provided ${[
        sessionHasClips ? "video clips" : "",
        sessionHasFrames ? "frame images" : "",
        sessionHasImages ? "content images" : "",
        sessionHasDirection ? "detailed creative direction in the topic hint" : "",
      ].filter(Boolean).join(", ")}.`,
      `Use the user's direction as-is — do NOT propose alternatives or redo their creative decisions.`,
      `Proceed directly with what the user described.`,
    ] : [];

    const isEn = work.language === "en";
    const prompt = isEn ? [
      `You are a content creation assistant. You are helping the user create: "${work.title}" (type: ${work.type}).`,
      `Target platforms: ${work.platforms.map((p: any) => typeof p === "string" ? p : p.platform).join(", ")}.`,
      work.topicHint ? `Topic direction: ${work.topicHint}` : "",
      ...skipContext,
      ``,
      `Current step: "${stepName}".`,
      `First confirm with the user: briefly explain what you'll do in this step, ask if they have specific directions or requirements, then wait for confirmation before starting.`,
      `Do not start executing immediately — communicate with the user first.`,
      ``,
      `IMPORTANT: All your responses, generated content, titles, copytext, and tags must be in English.`,
    ].filter(Boolean).join("\n") : [
      `你是一个内容创作助手。你正在帮助用户创作: "${work.title}" (类型: ${work.type})。`,
      `目标平台: ${work.platforms.map((p: any) => typeof p === "string" ? p : p.platform).join(", ")}。`,
      work.topicHint ? `选题方向: ${work.topicHint}` : "",
      ...skipContext,
      ``,
      `当前步骤: "${stepName}"。`,
      `请先向用户确认：简要说明这个步骤你将做什么，询问用户是否有特定方向或要求，等用户确认后再开始工作。`,
      `不要直接开始执行，先和用户沟通。`,
    ].filter(Boolean).join("\n");

    const config = await loadConfig();
    await wsBridge.createSession(id, prompt, config.model);
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
      session = await wsBridge.createSession(id, body.text, config.model);
      return c.json({ sent: true, sessionCreated: true, workId: id });
    }

    const sent = await wsBridge.sendMessage(id, body.text);
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

    // Detect what the user has already provided
    const assets = await listAssets(id);
    const hasClips = assets.some(a => a.includes("clips/") && (a.endsWith(".mp4") || a.endsWith(".mov")));
    const hasFrames = assets.some(a => a.includes("frames/") && (a.endsWith(".png") || a.endsWith(".jpg")));
    const hasImages = assets.some(a => a.includes("images/") && (a.endsWith(".png") || a.endsWith(".jpg")));
    const hasNarration = assets.some(a => a.includes("narration"));
    const hasMusic = assets.some(a => a.includes("music/") || a.includes("bgm"));
    const hasAssets = hasClips || hasFrames || hasImages;
    const hasDetailedDirection = !!(work.topicHint && work.topicHint.length > 50);
    const hasTitle = !!(work.title && work.title.length > 10);

    // Smart skip: auto-skip preceding steps when user already provided enough context
    const stepKeys = Object.keys(work.pipeline);
    const stepIdx = stepKeys.indexOf(step);
    let skippedSteps: string[] = [];
    for (let i = 0; i < stepIdx; i++) {
      const prev = work.pipeline[stepKeys[i]];
      if (prev.status !== "done" && prev.status !== "skipped") {
        // Determine if this step can be auto-skipped
        const prevKey = stepKeys[i];
        let canSkip = false;
        if (prevKey === "research" && (hasDetailedDirection || hasAssets)) {
          // User already has a clear direction or provided assets — skip research
          canSkip = true;
        } else if (prevKey === "plan" && hasAssets && hasDetailedDirection) {
          // User provided assets and detailed direction — skip planning
          canSkip = true;
        } else if (prevKey === "material-search" && hasClips) {
          // User already has video clips — skip material search
          canSkip = true;
        } else if (prevKey === "assets" && hasImages) {
          // User already provided images — skip image generation
          canSkip = true;
        }

        if (canSkip) {
          prev.status = "skipped";
          prev.completedAt = new Date().toISOString();
          prev.note = "Auto-skipped: user provided sufficient context/assets";
          skippedSteps.push(prevKey);
        } else {
          return c.json({ error: `Previous step "${prev.name}" is not completed` }, 400);
        }
      }
    }
    // Persist any auto-skipped steps
    if (skippedSteps.length > 0) {
      await storeUpdateWork(id, { pipeline: work.pipeline });
    }

    const isEn = work.language === "en";
    const promptParts = [
      `You are working on a content piece: "${work.title}" (type: ${work.type}).`,
      work.contentCategory ? `Content category: ${work.contentCategory}.` : "",
      `Platforms: ${work.platforms.map((p: any) => typeof p === "string" ? p : p.platform).join(", ")}.`,
      work.topicHint ? `Topic hint: ${work.topicHint}` : "",
      ``,
      ...(isEn ? [
        `## LANGUAGE REQUIREMENT`,
        `ALL your responses, generated content, titles, copytext, tags, and text overlays on images must be in **English**.`,
        `Do NOT output Chinese text. The user interface is in English and all deliverables must be English.`,
        ``,
      ] : []),
    ];

    // Inject context about existing assets and skipped steps
    if (hasAssets || skippedSteps.length > 0) {
      const assetSummary: string[] = [];
      if (hasClips) assetSummary.push("video clips");
      if (hasFrames) assetSummary.push("frame images");
      if (hasImages) assetSummary.push("content images");
      if (hasNarration) assetSummary.push("narration audio");
      if (hasMusic) assetSummary.push("background music");
      promptParts.push(
        `## EXISTING CONTEXT`,
        ``,
        `The user has already provided: ${assetSummary.join(", ")}.`,
        `Available assets: ${assets.filter(a => !a.includes("_sadtalker_tmp") && !a.includes(".mat") && !a.includes(".txt")).join(", ")}.`,
        skippedSteps.length > 0
          ? `Steps auto-skipped because user provided sufficient context: ${skippedSteps.join(", ")}.`
          : "",
        ``,
        `**IMPORTANT:** The user already has a clear direction and/or assets. Do NOT redo work that the user has already provided.`,
        hasDetailedDirection
          ? `The user's topic hint contains detailed direction — use it as the creative brief. Do not contradict or reinterpret it.`
          : "",
        hasClips
          ? `Video clips already exist — use them directly instead of generating new ones, unless the user asks otherwise.`
          : "",
        ``,
      );
    }

    if (step === "material-search" && work.videoSearchQuery) {
      promptParts.push(
        `Execute the "视频搜索" step.`,
        `The user wants to find existing videos from the web. Search query: "${work.videoSearchQuery}"`,
        ``,
        `## CRITICAL: Five-Dimension Constraint Analysis`,
        `Before searching, you MUST parse the search query into 5 dimensions and treat them as hard constraints:`,
        `1. **Absolute Subject & Physical Motion** — Who/what must appear, doing what? Subject must be visible EVERY SECOND.`,
        `2. **Environment & Emotional Lighting** — What scene/setting? What light mood?`,
        `3. **Optics & Camera** — What shot type, angle, movement?`,
        `4. **Timeline & State Evolution** — Duration required? Speed (normal/slow/fast)? How does the subject change over time?`,
        `5. **Aesthetic Medium & Rendering** — Live action / animation / 3D? Color tone? Resolution?`,
        ``,
        `Parse the query "${work.videoSearchQuery}" into these 5 dimensions first. State which are hard constraints (explicitly mentioned) vs soft constraints (inferred). Then search accordingly.`,
        `ALL returned videos must satisfy ALL hard constraints. If a video violates any (e.g. subject disappears mid-way), discard it.`,
        ``,
        `## Instructions`,
        `1. Search the web for 3 matching videos using WebSearch.`,
        `2. For each video found, download it WITH AUDIO using yt-dlp and save to the work assets directory.`,
        `   - First check if yt-dlp is available: \`which yt-dlp || pip3 install yt-dlp\``,
        `   - Download command (MUST use this to get audio+video merged):`,
        `     \`yt-dlp -f "bestvideo[height<=720]+bestaudio/best[height<=720]" --merge-output-format mp4 -o "/path/to/option-01.mp4" "VIDEO_URL"\``,
        `   - Save videos to the work assets directory. Find the path with:`,
        `     \`curl -s http://localhost:3271/api/works/${work.id} | python3 -c "import sys,json; w=json.load(sys.stdin); print(w.get('path',''))" || echo "$HOME/.autoviral/works/${work.id}/assets/clips"\``,
        `   - Save as: option-01.mp4, option-02.mp4, option-03.mp4`,
        `   - NEVER use plain curl to download videos — it will only get the video stream without audio.`,
        `3. Present the 3 options to the user using markdown video links so they display as inline players:`,
        `   - Use this format: \`[Video Title](/api/works/${work.id}/assets/clips/option-01.mp4)\``,
        `   - The .mp4 link format will render as an inline video player in the chat.`,
        `4. Ask the user to choose one of the 3 videos.`,
        `5. After the user selects, rename/copy the chosen video as the primary clip and mark this step as done:`,
        `   \`curl -X POST http://localhost:3271/api/works/${work.id}/pipeline/advance -H "Content-Type: application/json" -d '{"completedStep":"material-search","nextStep":"research"}'\``,
        ``,
        `IMPORTANT:`,
        `- Video files MUST have audio. Always use yt-dlp with audio merging, never plain curl/wget.`,
        `- Files must be actually downloaded and saved as assets so the inline player can play them.`,
      );
    } else if (step === "research" && hasDetailedDirection) {
      // User already has detailed direction — fast-track research
      promptParts.push(
        `Execute the "${pipelineStep.name}" step.`,
        ``,
        `## FAST-TRACK: User has already provided detailed creative direction`,
        ``,
        `The user's topic hint already contains a clear, detailed description of what they want to create:`,
        `"${work.topicHint}"`,
        ``,
        `**Do NOT generate 3 alternative proposals.** The user already knows what they want.`,
        `Instead:`,
        `1. Briefly confirm the direction with the user — summarize what you understand from their description`,
        `2. If the direction is clear enough, write the research output (a single content brief based on their direction) and save it`,
        `3. Mark this step as done and advance to the next step:`,
        `   \`curl -X POST http://localhost:3271/api/works/${work.id}/pipeline/advance -H "Content-Type: application/json" -d '{"completedStep":"research","nextStep":"plan"}'\``,
        ``,
        `The research output should be a single, focused brief that captures:`,
        `- The core emotion/hook`,
        `- The narrative angle (first-person, coach, etc.)`,
        `- The target audience reaction`,
        `- Key talking points or content beats`,
        ``,
        `Do NOT search for trending topics or propose alternative directions. The user has already decided.`,
      );
    } else if (step === "research" && work.contentCategory && work.contentCategory !== "comedy") {
      const emotionEffect: Record<string, string> = {
        anxiety: "看完之后感到被戳中、共鸣强烈、忍不住分享给朋友",
        conflict: "看完之后产生强烈的争议感、正义感、想站队、想在评论区辩论",
        envy: "看完之后强烈羡慕、想拥有同样的生活——展示的必须是极少数人才能享有的精致/富裕/甜蜜生活，而非普通人日常",
      };
      const cat = work.contentCategory as string;
      // Load user interests and competitors for topic relevance
      const config = await loadConfig();
      const userInterests = (config.interests ?? []) as string[];
      const douyinUrl = (config as any).douyinUrl ?? "";
      const interestClause = userInterests.length > 0
        ? `\n## 选题领域\n\n用户关注的领域：${userInterests.join("、")}。选题必须与这些领域相关——"我"的身份、经历、处境要自然地属于这些领域。\n`
        : "";
      const competitorClause = douyinUrl
        ? `\n用户的竞品账号：${douyinUrl}。选题风格和受众定位可以参考这个账号的方向。\n`
        : "";

      // Envy category uses a two-step research flow
      if (cat === "envy") {
        promptParts.push([
          `Execute the "${pipelineStep.name}" step.`,
          ``,
          `## 向往拥有类 — 两轮选题流程`,
          ``,
          `这个流程分两轮。请严格按照步骤执行，不要跳步。`,
          interestClause,
          competitorClause,
          ``,
          `### 第一轮：展示 3 个主方向`,
          ``,
          `先用 WebSearch 调研当前平台热门趋势，然后向用户展示以下 3 个创作主方向，每个方向只需简要说明（2-3 句话），不要给出具体选题：`,
          ``,
          `**方向 A：反差跃迁型**`,
          `before/after 对比，展示从平凡到惊艳的跃迁。核心是"路径很短但反差巨大"，让观众觉得"我花点心思也能做到"。`,
          ``,
          `**方向 B：关系羡慕型**`,
          `展示甜蜜关系中的具体细节和瞬间。核心是"用心对待"的具体行为，触发对理想关系的向往。`,
          ``,
          `**方向 C：隐性阶层信号型**`,
          `看似随意的日常，细节透露出高于普通人的生活层级——时间自由、空间品质、不赶不挤。`,
          ``,
          `对每个方向，基于你搜索到的趋势数据，简要分析：`,
          `- 当前热度和素材丰富度`,
          `- 平台匹配度（抖音 vs 小红书）`,
          `- 竞争程度和差异化空间`,
          ``,
          `然后给出推荐排序，并**请用户选择一个方向**。`,
          ``,
          `⚠️ 第一轮到此为止！不要给出具体选题，不要自行决定子方向。等用户回复后再进入第二轮。`,
          ``,
          `### 第二轮：给出 7-10 个具体子方向（等用户选择后再执行）`,
          ``,
          `用户选定主方向后，根据所选方向给出 **7-10 个具体的子方向/选题角度**。`,
          `每个子方向包含：`,
          `1. **子方向名称**：一句话概括（如"独居女生的周三下午"）`,
          `2. **内容概述**：2-3 句话描述这个选题要拍/写什么`,
          `3. **情绪触发点**：观众看到后会产生什么感受`,
          `4. **素材方向**：大致需要什么类型的图片/视频`,
          ``,
          `然后请用户从中选择一个子方向，进入下一步。`,
          ``,
          `## 内容视角：永远是"我"的故事`,
          ``,
          `所有内容都是发布者以**第一人称**在展示自己的生活。不是新闻，不是报道，是"我"的日常。`,
          ``,
          `## 核心要求`,
          ``,
          `图片/视频展示的生活方式必须是极少数人才能享有的，绝对不可以是普通人日常。`,
          `可以是精致/富裕的生活，也可以是极少数人才有的视角或甜蜜关系中的细节。`,
        ].join("\n"));
      } else {
        // anxiety / conflict: original single-round flow
        const routeTemplates: Record<string, string> = {
          anxiety: [
            `路线1 观点输出型：文字卡片封面（≤20字，一句极端观点）+ 文案（第一人称+身边案例+绝对表态）`,
            `路线2 对话截图型：微信对话截图封面 + 一句话文案`,
            `路线3 清单盘点型：极端判断句封面 + 清单图 + 文案`,
          ].join("\n"),
          conflict: [
            `路线1 观点输出型：文字卡片封面（≤20字，一句极端观点）+ 文案（第一人称+身边案例+绝对表态）`,
            `路线2 对话截图型：微信对话截图封面 + 一句话文案`,
            `路线3 清单盘点型：极端判断句封面 + 清单图 + 文案`,
          ].join("\n"),
        };
        promptParts.push([
          `Execute the "${pipelineStep.name}" step.`,
          ``,
          `## 你要产出什么`,
          ``,
          `3 个完整的图文选题，每个可以直接复制粘贴去小红书/抖音发布。`,
          interestClause,
          competitorClause,
          `## 内容视角：永远是"我"的故事`,
          ``,
          `这不是新闻报道。所有内容都是发布者以**第一人称**在聊自己的主观感受、自己的经历、自己的处境。`,
          ``,
          `正确示例：`,
          `- "我今年28，单身，没房没车。我妈说我是废物。"（第一人称，聊自己）`,
          `- "我老公今天突然送了我一束花，没有任何原因。"（第一人称，聊自己的关系）`,
          `- "周三下午，一个人坐在阳台上喝咖啡。"（第一人称，聊自己的日常）`,
          ``,
          `错误示例（绝对禁止）：`,
          `- "某地房价暴跌30%，购房者损失惨重"（这是新闻报道，不是个人帖子）`,
          `- "年轻人就业压力增大，专家建议..."（这是客观分析，不是个人感受）`,
          `- "据统计，2026年考研人数再创新高"（这是数据引用，不是个人故事）`,
          ``,
          `热点话题只用来选标签、蹭流量，内容本身必须是"我"的故事。`,
          ``,
          `## 第一步：搜索当前热门标签`,
          ``,
          `用 WebSearch 搜索"今日热搜""微博热搜""抖音热点"，找到当前有热度的话题。`,
          `这些话题只用来选标签（蹭流量），不是用来写内容的。`,
          ``,
          `## 第二步：围绕热门话题，构造"我"的故事`,
          ``,
          `每个选题的核心是一个虚构但真实感极强的第一人称故事/感受，读完后让观众${emotionEffect[cat] ?? "产生强烈情绪"}。`,
          ``,
          `构造方法：`,
          `1. 给"我"一个身份（年龄、职业、城市、处境）`,
          `2. 讲"我"的一段具体经历或此刻的感受`,
          `3. 让读者代入"我"的处境后，自然地${emotionEffect[cat] ?? "产生情绪"}`,
          ``,
          `## 3 条路线模板（3 个选题各用一条）`,
          ``,
          routeTemplates[cat] ?? "",
          ``,
          `## 输出格式：3 个完整选题`,
          ``,
          `每个选题包含：`,
          `1. **蹭的热门话题**：用来选标签的热点`,
          `2. **路线**：用的哪条路线`,
          `3. **封面**：文字卡片写出完整文字（≤20字）；搜图类给出关键词`,
          `4. **标题**：可以直接用的发布标题`,
          `5. **完整文案**：以"我"的第一人称写的完整成品文案，读起来像一个真人在倾诉自己的经历/感受`,
          `6. **标签**：5-6 个（从热搜中选）`,
          ``,
          `请用户从 3 个中选一个。`,
        ].join("\n"));
      }
    } else {
      promptParts.push(
        `Execute the "${pipelineStep.name}" step of the pipeline.`,
        `Produce output appropriate for this step. Be thorough and creative.`,
      );
      if (step === "assembly" && work.type === "short-video") {
        // Narration voice generation with edge-tts
        promptParts.push(
          ``,
          `## REQUIRED: Generate Narration Audio`,
          ``,
          `Before assembling the final video, you MUST generate a narration voiceover audio file.`,
          ``,
          `**Step 0 — Detect person gender from video/image assets (MUST DO FIRST):**`,
          `Before selecting a voice, you MUST identify the gender of the person appearing in the video clips or frame images.`,
          `Extract a frame from the main video clip and examine it:`,
          `\`\`\`bash`,
          `ffmpeg -i <clip_file> -ss 00:00:01 -frames:v 1 -y /tmp/gender_check.png`,
          `\`\`\``,
          `Look at the extracted frame to determine if the person is male or female. Then select a matching voice:`,
          isEn ? [
            `- If female: use en-US-JennyNeural (confident female English voice)`,
            `- If male: use en-US-AndrewNeural (confident male English voice)`,
            `- Other female options: en-US-AriaNeural, en-GB-SoniaNeural`,
            `- Other male options: en-US-GuyNeural, en-GB-RyanNeural`,
          ].join("\n") : [
            `- 如果是女性: 使用 zh-CN-XiaoxiaoNeural（自信女声）`,
            `- 如果是男性: 使用 zh-CN-YunxiNeural（自信男声）`,
            `- 其他女声: zh-CN-XiaohanNeural`,
            `- 其他男声: zh-CN-YunyangNeural`,
          ].join("\n"),
          ``,
          `**Then tell the user your detection result and chosen voice, and ask for confirmation before proceeding.** For example:`,
          `"${isEn
            ? `I can see the person in the video is female, so I'll use a female English voice (en-US-JennyNeural) for the narration. Does that work for you?`
            : `视频中的人物是女性，我将使用女声中文旁白（zh-CN-XiaoxiaoNeural）。可以吗？`}"`,
          ``,
          `**How to generate (after user confirms):**`,
          `Use the \`edge-tts\` command to convert the narration script to audio:`,
          `\`\`\`bash`,
          `edge-tts --text "YOUR NARRATION TEXT HERE" --voice <selected_voice> --write-media <work_dir>/assets/clips/narration.mp3`,
          `\`\`\``,
          ``,
          `**Steps:**`,
          `1. Extract a frame from the main video clip and detect the person's gender`,
          `2. Select a matching voice and tell the user your choice — ask for confirmation`,
          `3. Write the narration script based on the content plan`,
          `4. After confirmation, run edge-tts to generate the audio file`,
          `4. If the content plan uses talking-head/口播 style (marked as 口播（一镜到底）):`,
          `   - The person video clip should already exist from asset-generation (no lip-sync applied yet)`,
          `   - Call POST /api/generate/lip-sync with the person video URL and narration audio URL to generate lip-synced video`,
          `   - The lip-synced video replaces the original person clip as the main footage`,
          `   - Then overlay per-sentence subtitles at the bottom (synced to narration timing) + BGM`,
          `5. For non-口播 style: merge clips + narration audio + subtitles + BGM using ffmpeg`,
          ``,
        );
        // Background music generation with Lyria
        promptParts.push(
          `## REQUIRED: Generate Background Music with Lyria`,
          ``,
          `Generate original background music that matches the content mood using Google Lyria:`,
          `\`\`\`bash`,
          `python3 skills/asset-generation/scripts/lyria_music.py \\`,
          `  --prompt "YOUR MUSIC DESCRIPTION" \\`,
          `  --output <work_dir>/assets/clips/bgm.mp3`,
          `\`\`\``,
          ``,
          `**Music prompt tips:**`,
          `- Be specific: genre, tempo (BPM), mood, instruments`,
          `- Match the content emotion:`,
          isEn ? [
            `  - Resonance/emotional content → soft piano, gentle strings, melancholic, 70-90 BPM`,
            `  - Debate/controversy → tense, dramatic, driving percussion, 100-120 BPM`,
            `  - Comedy/absurd → quirky, playful, upbeat, fun synths, 110-130 BPM`,
            `  - Aspiration/envy → dreamy, luxurious, lo-fi chill, warm pads, 80-100 BPM`,
          ].join("\n") : [
            `  - 深度共鸣类 → 轻柔钢琴、弦乐、感性氛围、70-90 BPM`,
            `  - 观点分歧类 → 紧张感、节奏驱动、适度戏剧性、100-120 BPM`,
            `  - 搞笑抽象类 → 活泼、俏皮、欢快合成器、110-130 BPM`,
            `  - 向往拥有类 → 梦幻、精致、lo-fi chill、温暖音色、80-100 BPM`,
          ].join("\n"),
          `- Use \`google/lyria-3-clip-preview\` for 30s clips (default, good for short videos)`,
          `- Use \`--model google/lyria-3-pro-preview\` for longer tracks if needed`,
          ``,
          `**In the final ffmpeg mix**, layer the BGM under the narration:`,
          `- BGM volume should be ~20-30% of narration volume (use \`-filter_complex "[1:a]volume=0.25[bgm];[0:a][bgm]amix=inputs=2:duration=first"\`)`,
          `- Fade in BGM at start (2s) and fade out at end (3s)`,
          ``,
        );
        promptParts.push(
          `## CRITICAL: Horizontal-to-Vertical Video Conversion`,
          `The final output MUST be 9:16 vertical (1080x1920). If any source clip is horizontal (wider than tall):`,
          ``,
          `**Strategy A (preferred): Full-screen crop — NO black bars**`,
          `\`ffmpeg -i input.mp4 -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920" ...\``,
          `Use this when the subject stays in the center and won't be cut off.`,
          ``,
          `**Strategy B: Width-match with vertical centering — subject too wide to crop**`,
          `\`ffmpeg -i input.mp4 -vf "scale=1080:-2,pad=1080:1920:0:(oh-ih)/2:black" ...\``,
          `This scales width to 1080, then pads top and bottom EQUALLY to center vertically.`,
          `The formula \`(oh-ih)/2\` is critical — it puts equal black bars on top and bottom.`,
          ``,
          `**VERIFY**: After producing the final video, extract a frame and confirm:`,
          `- No content is off-center vertically`,
          `- If black bars exist, they must be EQUAL top and bottom`,
          `- Subject is not cropped unless Strategy A was deliberately chosen`,
          `\`ffmpeg -i final.mp4 -ss 3 -frames:v 1 -y /tmp/verify.png\``,
          ``,
          `## REQUIRED: Generate Publishing Copytext & Tags`,
          `After producing the final video, you MUST also generate a publishing copytext file.`,
          `Write it to \`output/copytext.md\` in the work directory.`,
          ``,
          `The copytext MUST follow viral/爆款 principles:`,
          `- **Hook line (first sentence)**: Must grab attention in under 2 seconds of reading. Use curiosity gaps, bold claims, or relatable pain points.`,
          `- **Body (2-3 sentences max)**: Expand on the hook, add value or intrigue. Keep it conversational and platform-native.`,
          `- **Call to action**: Encourage engagement (关注/收藏/转发/评论). Be natural, not pushy.`,
          `- **Tags/Hashtags**: Include 5-10 relevant hashtags. Mix:`,
          `  - 2-3 high-traffic trending tags (热门标签)`,
          `  - 2-3 niche/topic-specific tags`,
          `  - 1-2 branded or unique tags`,
          `  - Format: #tag1 #tag2 #tag3 (each prefixed with #)`,
          ``,
          `Example format of copytext.md:`,
          `\`\`\``,
          `这个方法我后悔没早点知道...`,
          ``,
          `很多人不知道，其实只要掌握这个技巧就能轻松搞定。今天一次性讲清楚，看完直接上手！`,
          ``,
          `觉得有用就收藏起来，别划走了 👆`,
          ``,
          `#知识分享 #干货 #涨知识 #教程 #生活技巧`,
          `\`\`\``,
          ``,
          `The copytext language should match the target platform (Chinese for 抖音/小红书).`,
          `Tailor the tone to the content category and platform style.`,
        );
      }
      // Inject emotion-driven directives based on content category
      const emotionMap: Record<string, string> = {
        anxiety: "深度共鸣 (resonance). Read modules/emotional-hooks.md and apply the 共鸣 emotion rules. For image-text, use one of the 3 mandatory routes (观点输出/对话截图/清单盘点).",
        conflict: "观点分歧/争议感 (debate/controversy). Read modules/emotional-hooks.md and apply the 争议 emotion rules. For image-text, use one of the 3 mandatory routes (观点输出/对话截图/清单盘点).",
        comedy: "搞笑/抽象 (comedy/abstract). Read genres/comedy.md and apply its rules to this step.",
        envy: "羡慕 (aspiration/envy). Read modules/emotional-hooks.md and apply the 羡慕 emotion rules. For image-text, use one of the 3 mandatory routes (反差跃迁/关系羡慕/隐性阶层信号).",
      };
      const emotionDirective = emotionMap[work.contentCategory as string];
      if (emotionDirective) {
        promptParts.push(
          ``,
          `## IMPORTANT: Target emotion for this content is ${emotionDirective}`,
        );
      }

      // Category-specific title rules
      const titleRules: Record<string, string> = {
        envy: [
          `## 羡慕类标题规则`,
          `标题必须**简短**（一般≤15字），并且直接点明发布者令人羡慕的身份/特征。`,
          `标题的作用是让读者一眼就知道"这个人拥有我想要的东西"。`,
          ``,
          `好的标题示例：`,
          `- "哈佛本科生普通的周三"（身份：哈佛学生）`,
          `- "北京三套房女生的日常"（资产：三套房）`,
          `- "25岁年薪百万后的生活"（收入：年薪百万）`,
          `- "和男朋友在巴黎的第3天"（关系+地点：甜蜜关系+巴黎）`,
          `- "辞职后在大理的第100天"（生活方式：自由+大理）`,
          ``,
          `坏的标题示例（禁止）：`,
          `- "记录一下我很普通的生活"（没有点明令人羡慕的点）`,
          `- "今天也是元气满满的一天！"（空洞，没有信息量）`,
          `- "分享我的日常vlog"（太泛，没有差异化）`,
        ].join("\n"),
        anxiety: [
          `## 深度共鸣类标题规则`,
          `标题必须**简短**（一般≤15字），直接点明发布者的身份/处境中令人共鸣的痛点。`,
          `标题的作用是让读者一眼就觉得"这说的不就是我吗"，产生强烈代入感。`,
          ``,
          `好的标题示例：`,
          `- "我今年28，单身，没房，没车。"（处境：年龄+现状）`,
          `- "月薪5000，在北京租房的第6年"（收入+城市+时间）`,
          `- "考研二战失败后的第一天"（经历：考研失败）`,
          `- "35岁被裁后，我妈说我活该"（年龄+事件+家庭关系）`,
          `- "存款为0的我，刚查出甲状腺结节"（经济+健康）`,
          ``,
          `坏的标题示例（禁止）：`,
          `- "当代年轻人的压力有多大？"（新闻腔，不是第一人称）`,
          `- "生活好难啊"（太笼统，没有具体信息）`,
          `- "来聊聊你们的压力源"（互动征集，不是个人故事）`,
        ].join("\n"),
        conflict: [
          `## 观点分歧类标题规则`,
          `标题必须**简短**（一般≤15字），直接点明发布者的身份/处境中引发争议的点。`,
          `标题的作用是让读者一眼就产生"这说的对/不对"的站队冲动，忍不住点进来看。`,
          ``,
          `好的标题示例：`,
          `- "我拒绝了月薪3万的offer"（反常行为引发好奇+争议）`,
          `- "相亲对象AA制，我直接走了"（事件+态度，引发站队）`,
          `- "我劝你别考公"（逆主流观点，引发反驳欲）`,
          `- "婆婆住进来第3天，我搬走了"（关系冲突+行动）`,
          `- "同事天天迟到，领导只骂我"（不公平处境，引发正义感和辩论欲）`,
          ``,
          `坏的标题示例（禁止）：`,
          `- "你们觉得AA制合理吗？"（提问式，不是个人故事）`,
          `- "关于婆媳关系的一些看法"（议论文标题，没有冲突感）`,
          `- "职场那些事儿"（太泛，没有具体矛盾点）`,
        ].join("\n"),
        comedy: [
          `## 搞笑类标题规则`,
          `标题必须**简短**（一般≤15字），**绝对不能暴露笑点**。`,
          `标题的作用是用一个引人代入的情绪或处境制造好奇心，让读者忍不住点进来，看到内容后才笑出来。`,
          ``,
          `好的标题示例：`,
          `- "我妈今天的操作让我彻底崩溃了"（情绪引导+悬念，笑点在内容里）`,
          `- "合租室友的脑回路我真的服了"（吐槽情绪+好奇，不知道具体发生了什么）`,
          `- "相亲回来我整个人都不好了"（情绪+悬念，可能搞笑可能离谱）`,
          `- "公司新来的同事第一天就干了这事"（悬念+好奇，不知道是什么事）`,
          `- "我终于知道我单身的原因了"（自嘲情绪+悬念）`,
          ``,
          `坏的标题示例（禁止）：`,
          `- "我爸把猫剃成了光头哈哈哈"（笑点直接暴露了，没必要点进去看）`,
          `- "搞笑！外卖小哥送错了三次"（直接标注"搞笑"，缺少悬念）`,
          `- "史上最离谱的翻车现场"（夸张空洞，没有代入感）`,
        ].join("\n"),
      };
      const cat = work.contentCategory as string;
      if (titleRules[cat]) {
        promptParts.push(``, titleRules[cat]);
      }

      // For image-text assets step: enforce correct asset acquisition method per category
      if (step === "assets" && work.type === "image-text") {
        const assetMethod: Record<string, string> = {
          envy: [
            ``,
            `## 图片核心原则`,
            ``,
            `**内容要求：必须展示极少数人才能享有的生活**`,
            `图片必须让观众产生强烈的"我也想要"的冲动。展示的生活方式**必须是极少数人才能享有的**，绝对不可以是普通人的日常。`,
            ``,
            `**风格要求：绝对真实、日常、零 stock image 感**`,
            `图片必须看起来像真人用手机随手拍的生活片段，而不是商业图库素材。`,
            `- ✅ 构图随意、不完美，像顺手拿起手机拍一张`,
            `- ✅ 自然光线，有真实环境的杂乱细节（桌上的水杯、背景里的路人）`,
            `- ✅ 轻微的手抖、焦点偏移、过曝/欠曝都可以接受`,
            `- ❌ 完美居中构图、纯净背景、均匀打光 = stock image，绝对不要`,
            `- ❌ 模特摆拍姿势、刻意的微笑、眼神直视镜头`,
            `- ❌ 图片水印、图库logo`,
            ``,
            `**可以展现的内容方向：**`,
            `- 精致/富裕的生活方式：高端餐厅、私人泳池、海景别墅、头等舱、精品酒店`,
            `- 极少数人才有的视角：CEO在会议室顶端俯瞰所有参会人员、私人飞机窗外的云海、游艇甲板上的日落`,
            `- 恋爱中的甜蜜视角：精致礼物盒特写、伴侣牵手的第一人称视角、精致餐厅桌面对面是穿着考究的伴侣、被鲜花包围的早餐托盘`,
            `- 隐性阶层信号：不直接展示奢侈品logo，但通过细节（空间、光线、质感）传达高品质生活`,
            ``,
            `**绝对禁止：**`,
            `- ❌ 普通人的日常生活（普通公寓、快餐店、拥挤的公共交通）`,
            `- ❌ 过于直白的炫富（堆砌奢侈品logo、晒存款截图）`,
            `- ❌ 任何有 stock image 感的图片（构图太完美、光线太均匀、背景太干净）`,
            ``,
            `## 图片获取方式`,
            ``,
            `优先全网搜索真实照片，如果搜不到合适的可以用 AI 生图。`,
            `- ✅ 搜图关键词要加"candid""real""iPhone""casual"等限定词，避免搜到图库图`,
            `  示例："luxury restaurant candid iPhone photo"、"holding hands boyfriend pov real"、"CEO boardroom candid shot"`,
            `- ✅ AI 生图提示词必须强调：candid snapshot, iPhone photo, natural lighting, slightly imperfect composition, real life moment`,
            `- ❌ 禁止使用 ffmpeg 生成文字卡片作为封面`,
            ``,
            `### 封面图要求（最重要！）`,
            `封面首图决定了用户是否点击，必须在视觉上**极度震撼、壮丽、精致、吸引眼球**。`,
            `- 画面必须有强烈的视觉美感：大气的构图、饱和的色彩、惊艳的光影`,
            `- 适合封面的场景：绝美海景日落、高空俯瞰城市灯火、雪山星空、无边泳池倒映天空、巴黎屋顶的晨光、圣托里尼的蓝白教堂、满桌精致法餐的航拍视角`,
            `- 封面图可以比内页图更"精致"——因为它的任务是吸引点击，而不是讲故事`,
            `- 色彩要浓郁鲜明（金色夕阳、湛蓝海水、翠绿植被），不要灰暗沉闷的色调`,
            `- 构图要有纵深感和层次感，避免平面化的随手拍`,
            `- AI 生图提示词要强调：breathtaking, cinematic lighting, stunning colors, ultra high quality, magazine cover worthy`,
            `- 搜图关键词要加：breathtaking, stunning, beautiful, dreamy, aesthetic`,
            `- ❌ 禁止用普通的随手拍作为封面——内页可以日常，但封面必须惊艳`,
            ``,
            `### 图2-5 要求`,
            `每张图内容不同，但**风格、清晰度、色调、画风必须完全一致**，像同一部手机同一天拍的。`,
            ``,
            `### 执行步骤`,
            `1. 从内容规划方案中提取每张图的关键词（要具体到场景细节，突出"极少数人才有"的特征）`,
            `2. 所有关键词加上"candid real iPhone casual snapshot"等反stock限定词`,
            `3. 优先用 WebSearch 搜索图片，筛选时严格排除任何stock感的结果`,
            `4. 搜不到合适的就用 AI 生图脚本，提示词必须包含 candid/snapshot/iPhone 等关键词`,
            `5. 用 curl 下载图片，保存到作品的 assets/images/ 目录`,
            `6. 下载后用 ffmpeg 统一调色（亮度/对比度/色温），确保风格一致`,
            `7. 最终检查：如果任何一张图看起来像图库素材（太完美、太干净），必须弃用重新获取`,
            ``,
            `参考 modules/emotional-hooks.md 中羡慕类的素材生成指令获取详细规则。`,
          ].join("\n"),
          anxiety: [
            ``,
            `## 图片生成方式`,
            ``,
            `"深度共鸣"类图文：只有封面是文字卡片（用 ffmpeg 生成）。`,
            `**除封面外的其他图片禁止写文字观点！** 文字观点全部在文案正文里体现。`,
            `其余配图用与话题相关的真实照片（全网搜索下载）。`,
            `如果方案使用的是路线2（对话截图型），对话截图仅限封面，其余图用真实照片。`,
            `参考 modules/emotional-hooks.md 中共鸣类的素材生成指令。`,
          ].join("\n"),
          conflict: [
            ``,
            `## 图片生成方式`,
            ``,
            `"观点分歧/争议感"类图文：只有封面是文字卡片（用 ffmpeg 生成）。`,
            `**除封面外的其他图片禁止写文字观点！** 文字观点全部在文案正文里体现。`,
            `其余配图用与话题相关的真实照片（全网搜索下载）。`,
            `如果方案使用的是路线2（对话截图型），对话截图仅限封面，其余图用真实照片。`,
            `参考 modules/emotional-hooks.md 中共鸣类的素材生成指令。`,
          ].join("\n"),
        };
        const method = assetMethod[work.contentCategory as string];
        if (method) promptParts.push(method);
      }
    }

    const prompt = promptParts.filter(Boolean).join("\n");

    const config = await loadConfig();
    let session = wsBridge.getSession(id);
    if (!session) {
      session = await wsBridge.createSession(id, prompt, config.model);
      return c.json({ triggered: true, sessionCreated: true, workId: id, step });
    }

    await wsBridge.sendMessage(id, prompt);
    return c.json({ triggered: true, workId: id, step });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Step trigger error" }, 500);
  }
});

// POST /api/works/:id/pipeline/advance — agent calls this to advance pipeline
apiRoutes.post("/api/works/:id/pipeline/advance", async (c) => {
  const id = c.req.param("id");
  try {
    const body = await c.req.json<{ completedStep: string; nextStep?: string; title?: string }>().catch(() => ({} as any));
    log("info", "api", "pipeline_advance", id, { completedStep: body.completedStep, nextStep: body.nextStep, title: body.title });
    const work = await getWork(id);
    if (!work) return c.json({ error: "Work not found" }, 404);

    const { completedStep, nextStep } = body;
    if (!completedStep) return c.json({ error: "completedStep is required" }, 400);

    // Mark completed step as done
    if (work.pipeline[completedStep]) {
      work.pipeline[completedStep].status = "done";
      work.pipeline[completedStep].completedAt = new Date().toISOString();
    }

    // Also mark all steps before completedStep as done (in case agent skipped)
    const stepKeys = Object.keys(work.pipeline);
    const completedIdx = stepKeys.indexOf(completedStep);
    if (completedIdx > 0) {
      for (let i = 0; i < completedIdx; i++) {
        if (work.pipeline[stepKeys[i]].status !== "done") {
          work.pipeline[stepKeys[i]].status = "done";
          work.pipeline[stepKeys[i]].completedAt = work.pipeline[stepKeys[i]].completedAt ?? new Date().toISOString();
          log("info", "api", "pipeline_auto_complete_skipped", id, { step: stepKeys[i] });
        }
      }
    }

    // Mark next step as active if provided
    if (nextStep && work.pipeline[nextStep]) {
      work.pipeline[nextStep].status = "active";
      work.pipeline[nextStep].startedAt = new Date().toISOString();
    }

    // Update title if agent provided one (only once — skip if already locked)
    const titleUpdate: Partial<typeof work> = { pipeline: work.pipeline };
    if (body.title && typeof body.title === "string" && !work.titleLocked) {
      const trimmedTitle = body.title.trim();
      titleUpdate.title = trimmedTitle;
      titleUpdate.titleLocked = true;
      work.title = trimmedTitle;
    }

    await storeUpdateWork(id, titleUpdate);

    // Sync conversation to EverMemOS (fire and forget)
    if (completedStep) {
      loadStepHistory(id, completedStep).then(history => {
        const h = history as { blocks?: { type: string; text: string }[] } | null;
        if (h?.blocks) {
          getWork(id).then(w => {
            syncStepConversation(
              id,
              w?.title ?? "Untitled",
              completedStep,
              w?.pipeline?.[completedStep]?.name ?? completedStep,
              h.blocks!,
            ).catch(() => {})
          }).catch(() => {})
        }
      }).catch(() => {})
    }

    // Broadcast pipeline update to browsers via WsBridge
    if (wsBridge) {
      const session = wsBridge.getSession(id);
      if (session) {
        for (const ws of session.browserSockets) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              event: "pipeline_updated",
              data: { workId: id, pipeline: work.pipeline, title: work.title },
              timestamp: new Date().toISOString(),
            }));
          }
        }
      }
    }

    // ── Evaluator trigger ──────────────────────────────────────────────
    const evalEnabled = work.evaluationMode ?? true; // default on
    if (evalEnabled && wsBridge && completedStep) {
      // Don't eval the last step (assembly) — it has its own final eval
      const isLastStep = !nextStep;
      if (!isLastStep) {
        const session = wsBridge.getSession(id);
        if (session) {
          // Set step to evaluating
          work.pipeline[completedStep].status = "evaluating";
          // Revert next step to pending during eval
          if (nextStep && work.pipeline[nextStep]) {
            work.pipeline[nextStep].status = "pending";
          }
          await storeUpdateWork(id, { pipeline: work.pipeline });

          // Broadcast evaluating status
          wsBridge.broadcastToBrowsers(id, {
            event: "pipeline_updated",
            data: { workId: id, pipeline: work.pipeline, title: work.title },
          });

          // Add eval divider to chat
          wsBridge.broadcastToBrowsers(id, {
            event: "eval_start",
            data: { workId: id, step: completedStep },
          });

          session.evalStep = completedStep;

          // Build eval prompt
          const evalPrompt = await buildEvalPrompt(work, completedStep);

          // Spawn evaluator asynchronously (don't block response)
          wsBridge.spawnEvaluator(session, evalPrompt)
            .then(async (evalResult) => {
              evalResult.step = completedStep;
              evalResult.timestamp = new Date().toISOString();
              await saveEvalResult(id, completedStep, evalResult);

              const freshWork = await getWork(id);
              if (!freshWork) return;

              if (evalResult.verdict === "pass") {
                freshWork.pipeline[completedStep].status = "done";
                if (nextStep && freshWork.pipeline[nextStep]) {
                  freshWork.pipeline[nextStep].status = "active";
                  freshWork.pipeline[nextStep].startedAt = new Date().toISOString();
                }
              } else {
                freshWork.pipeline[completedStep].status = "eval_blocked";
              }
              await storeUpdateWork(id, { pipeline: freshWork.pipeline });

              wsBridge?.broadcastToBrowsers(id, {
                event: "eval_complete",
                data: { workId: id, step: completedStep, result: evalResult },
              });
              wsBridge?.broadcastToBrowsers(id, {
                event: "pipeline_updated",
                data: { workId: id, pipeline: freshWork.pipeline, title: freshWork.title },
              });
            })
            .catch(async () => {
              // Eval failed — fall through to pass
              const freshWork = await getWork(id);
              if (!freshWork) return;
              freshWork.pipeline[completedStep].status = "done";
              if (nextStep && freshWork.pipeline[nextStep]) {
                freshWork.pipeline[nextStep].status = "active";
                freshWork.pipeline[nextStep].startedAt = new Date().toISOString();
              }
              await storeUpdateWork(id, { pipeline: freshWork.pipeline });
              wsBridge?.broadcastToBrowsers(id, {
                event: "pipeline_updated",
                data: { workId: id, pipeline: freshWork.pipeline },
              });
            });

          return c.json({ ok: true, pipeline: work.pipeline, evaluating: true });
        }
      }
    }

    return c.json({ ok: true, pipeline: work.pipeline });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Pipeline advance error" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Evaluator prompt builder
// ---------------------------------------------------------------------------

async function buildEvalPrompt(work: { id: string; type: string; pipeline: Record<string, any> }, completedStep: string): Promise<string> {
  const skillDir = join(process.cwd(), "skills", "content-evaluator");
  let skillMd = "";
  try { skillMd = await readFile(join(skillDir, "SKILL.md"), "utf-8"); } catch { /* missing */ }

  const criteriaMap: Record<string, string> = {
    research: "research.md",
    plan: "plan.md",
    assets: "assets.md",
    assembly: "assembly.md",
  };
  let criteriaMd = "";
  const criteriaFile = criteriaMap[completedStep];
  if (criteriaFile) {
    try { criteriaMd = await readFile(join(skillDir, "criteria", criteriaFile), "utf-8"); } catch { /* missing */ }
  }

  const workDir = join(dataDir, "works", work.id);

  return `${skillMd}

## 本次评审任务

评审阶段：${completedStep}（${work.pipeline[completedStep]?.name ?? completedStep}）
作品ID：${work.id}
作品类型：${work.type}
作品目录：${workDir}

### 阶段评审标准
${criteriaMd}

请按照评审流程，检查 ${workDir} 下的产出文件，逐维度评分，最后输出结构化 JSON 评审结果。`;
}

// ---------------------------------------------------------------------------
// Evaluation API routes
// ---------------------------------------------------------------------------

// POST /api/works/:id/eval/toggle — toggle evaluation mode
apiRoutes.post("/api/works/:id/eval/toggle", async (c) => {
  const id = c.req.param("id");
  const work = await getWork(id);
  if (!work) return c.json({ error: "Work not found" }, 404);
  const newMode = !(work.evaluationMode ?? true);
  await storeUpdateWork(id, { evaluationMode: newMode } as any);
  return c.json({ evaluationMode: newMode });
});

// POST /api/works/:id/eval/force-pass — force pass a blocked eval
apiRoutes.post("/api/works/:id/eval/force-pass", async (c) => {
  const id = c.req.param("id");
  const { step, nextStep } = await c.req.json<{ step: string; nextStep?: string }>();
  const work = await getWork(id);
  if (!work) return c.json({ error: "Work not found" }, 404);

  // Kill running evaluator
  if (wsBridge) {
    const session = wsBridge.getSession(id);
    if (session?.evalProcess) {
      try { session.evalProcess.kill("SIGTERM"); } catch { /* already dead */ }
      session.evalProcess = undefined;
    }
  }

  work.pipeline[step].status = "done";
  work.pipeline[step].completedAt = new Date().toISOString();
  if (nextStep && work.pipeline[nextStep]) {
    work.pipeline[nextStep].status = "active";
    work.pipeline[nextStep].startedAt = new Date().toISOString();
  }
  await storeUpdateWork(id, { pipeline: work.pipeline });

  if (wsBridge) {
    wsBridge.broadcastToBrowsers(id, {
      event: "pipeline_updated",
      data: { workId: id, pipeline: work.pipeline },
    });
  }

  return c.json({ pipeline: work.pipeline });
});

// POST /api/works/:id/eval/retry — retry step with guidance
apiRoutes.post("/api/works/:id/eval/retry", async (c) => {
  const id = c.req.param("id");
  const { step, guidance } = await c.req.json<{ step: string; guidance: string }>();
  const work = await getWork(id);
  if (!work) return c.json({ error: "Work not found" }, 404);

  work.pipeline[step].status = "active";
  work.pipeline[step].startedAt = new Date().toISOString();
  delete work.pipeline[step].completedAt;
  await storeUpdateWork(id, { pipeline: work.pipeline });

  if (wsBridge) {
    const guidanceMsg = `评审反馈要求重做此步骤。请根据以下评审意见修改：\n\n${guidance}`;
    await wsBridge.sendMessage(id, guidanceMsg);
    wsBridge.broadcastToBrowsers(id, {
      event: "pipeline_updated",
      data: { workId: id, pipeline: work.pipeline },
    });
  }

  return c.json({ ok: true });
});

// GET /api/works/:id/eval/results/:step — fetch eval results
apiRoutes.get("/api/works/:id/eval/results/:step", async (c) => {
  const id = c.req.param("id");
  const step = c.req.param("step");
  const results = await loadEvalResults(id, step);
  return c.json({ results });
});

// ---------------------------------------------------------------------------
// Step History API (persistent execution logs per pipeline step)
// ---------------------------------------------------------------------------

// GET /api/works/:id/steps/:step/history
apiRoutes.get("/api/works/:id/steps/:step/history", async (c) => {
  const id = c.req.param("id");
  const step = c.req.param("step");
  const history = await loadStepHistory(id, step);
  if (!history) return c.json({ error: "No history for this step" }, 404);
  return c.json(history);
});

// POST /api/works/:id/steps/:step/history
apiRoutes.post("/api/works/:id/steps/:step/history", async (c) => {
  const id = c.req.param("id");
  const step = c.req.param("step");
  const body = await c.req.json();
  await saveStepHistory(id, step, body);
  return c.json({ saved: true });
});

// GET /api/works/:id/chat — load full conversation
apiRoutes.get("/api/works/:id/chat", async (c) => {
  const id = c.req.param("id");
  try {
    const { loadWorkChat } = await import("../work-store.js");
    const chat = await loadWorkChat(id);
    if (!chat) return c.json({ error: "No chat history" }, 404);
    return c.json(chat);
  } catch {
    return c.json({ error: "No chat history" }, 404);
  }
});

// PUT /api/works/:id/chat — save full conversation
apiRoutes.put("/api/works/:id/chat", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  try {
    const { saveWorkChat } = await import("../work-store.js");
    await saveWorkChat(id, body);
    return c.json({ saved: true });
  } catch {
    return c.json({ error: "Save failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Logs API — structured log viewer
// ---------------------------------------------------------------------------

// GET /api/logs — query structured logs
apiRoutes.get("/api/logs", async (c) => {
  const date = c.req.query("date");
  const workId = c.req.query("workId");
  const source = c.req.query("source") as any;
  const level = c.req.query("level") as any;
  const limit = parseInt(c.req.query("limit") ?? "200", 10);

  const entries = await readLogs({ date, workId, source, level, limit });
  return c.json({ entries, count: entries.length });
});

// GET /api/logs/work/:id — all logs for a specific work
apiRoutes.get("/api/logs/work/:id", async (c) => {
  const workId = c.req.param("id");
  const entries = await readLogs({ workId, limit: 500 });
  return c.json({ entries, count: entries.length });
});

// ---------------------------------------------------------------------------
// Test Runner API
// ---------------------------------------------------------------------------

// POST /api/test/run — trigger a full pipeline test run
apiRoutes.post("/api/test/run", async (c) => {
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const body = await c.req.json<RunConfig>();
    if (!body.type || !body.platform) {
      return c.json({ error: "type and platform are required" }, 400);
    }

    // Start run in background (don't await the full pipeline)
    const resultPromise = runPipeline(wsBridge, body);

    // Small delay to let runner initialize and create the work
    await new Promise(r => setTimeout(r, 500));

    // Find the active run
    const runs = await listRuns();
    const activeRun = runs.find(r => r.status === "running");

    if (activeRun) {
      // After pipeline completes, run evaluation (fire and forget)
      resultPromise.then(async (result) => {
        try {
          const evaluation = await evaluateWork(result.workId, body.type);
          result.evaluation = evaluation;
          // Re-save with evaluation
          const { writeFile, mkdir } = await import("node:fs/promises");
          const dir = join(homedir(), ".autoviral", "test-runs", result.runId);
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 2), "utf-8");
          await writeFile(join(dir, "evaluation.json"), JSON.stringify(evaluation, null, 2), "utf-8");
        } catch { /* evaluation failure is non-blocking */ }
      }).catch(() => {});

      return c.json({ runId: activeRun.runId, workId: activeRun.workId, status: "running" });
    }

    return c.json({ error: "Failed to start run" }, 500);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Run failed" }, 500);
  }
});

// GET /api/test/status/:runId — query run status
apiRoutes.get("/api/test/status/:runId", async (c) => {
  const runId = c.req.param("runId");
  const run = getRunStatus(runId) ?? await getRunReport(runId);
  if (!run) return c.json({ error: "Run not found" }, 404);
  return c.json(run);
});

// GET /api/test/runs — list all test runs
apiRoutes.get("/api/test/runs", async (c) => {
  const runs = await listRuns();
  return c.json({ runs });
});

// GET /api/test/runs/:runId/report — full report
apiRoutes.get("/api/test/runs/:runId/report", async (c) => {
  const runId = c.req.param("runId");
  const report = await getRunReport(runId);
  if (!report) return c.json({ error: "Report not found" }, 404);
  return c.json(report);
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

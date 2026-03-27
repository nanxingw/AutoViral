import { Hono } from "hono";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, extname } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { loadConfig, saveConfig } from "../config.js";
import {
  listWorks, getWork, createWork as storeCreateWork,
  updateWork as storeUpdateWork, deleteWork as storeDeleteWork,
  listAssets, getAssetPath, saveStepHistory, loadStepHistory,
  saveWorkChat, saveEvalResult, loadAllEvalResults,
  type Work, type PipelineStep, type EvalResult,
} from "../work-store.js";
import { MemoryClient } from "../memory.js";
import type { WsBridge } from "../ws-bridge.js";
import { getProvider, getDefaultProvider, listProviders } from "../providers/registry.js";
import { listSharedAssetsWithMeta, getSharedAssetPath, validateCategory, sanitizeFilename, saveSharedAsset, deleteSharedAsset, moveSharedAsset } from "../shared-assets.js";
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
    // Attach coverImage: prefer final video (for keyframe), then output image, then first asset image
    const enriched = await Promise.all(works.map(async (w) => {
      try {
        const assets = await listAssets(w.id);
        // 1. Final video — browser will show keyframe as poster
        const finalVideo = assets.find((a: string) =>
          /\.(mp4|mov|webm)$/i.test(a) && /final/i.test(a)
        );
        if (finalVideo) {
          return { ...w, coverImage: `/api/works/${w.id}/assets/${finalVideo.split("/").map(encodeURIComponent).join("/")}`, coverIsVideo: true };
        }
        // 2. Output image (thumbnail/cover)
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
    const { stat } = await import("node:fs/promises");
    const fileStat = await stat(filePath);
    const fileSize = fileStat.size;
    const mimeType = getMimeType(filePath);
    const rangeHeader = c.req.header("range");

    // Support HTTP Range requests (required for browser video/audio playback)
    if (rangeHeader && (mimeType.startsWith("video/") || mimeType.startsWith("audio/"))) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        const fullContent = await readFile(filePath);
        const slice = fullContent.subarray(start, end + 1);
        return new Response(slice, {
          status: 206,
          headers: {
            "Content-Type": mimeType,
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Content-Length": String(chunkSize),
            "Accept-Ranges": "bytes",
          },
        });
      }
    }

    const content = await readFile(filePath);
    return new Response(content, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
      },
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
  const { workId, prompt, width, height, filename, provider: providerName, referenceImage,
    aspectRatio, imageSize, seed, temperature, model } = body;
  if (!workId || !prompt || !filename) {
    return c.json({ success: false, error: "Missing required fields", code: "INVALID_PARAMS" }, 400);
  }
  const provider = providerName ? getProvider(providerName) : getDefaultProvider("image");
  if (!provider) {
    return c.json({ success: false, error: "No image provider available", code: "INVALID_PARAMS" }, 400);
  }
  try {
    const result = await provider.generateImage({
      prompt, width, height, workId, filename, referenceImage,
      aspectRatio, imageSize, seed, temperature, model,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/generate/video
apiRoutes.post("/api/generate/video", async (c) => {
  const body = await c.req.json();
  const { workId, prompt, firstFrame, lastFrame, resolution, filename, provider: providerName } = body;
  if (!workId || !prompt || !filename) {
    return c.json({ success: false, error: "Missing required fields", code: "INVALID_PARAMS" }, 400);
  }
  const provider = providerName ? getProvider(providerName) : getDefaultProvider("video");
  if (!provider) {
    return c.json({ success: false, error: "No video provider available", code: "INVALID_PARAMS" }, 400);
  }
  try {
    const result = await provider.generateVideo({ prompt, firstFrame, lastFrame, resolution, workId, filename });
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

apiRoutes.get("/api/shared-assets", async (c) => {
  const assets = await listSharedAssetsWithMeta();
  return c.json(assets);
});

apiRoutes.get("/api/shared-assets/:category/:file", async (c) => {
  const category = c.req.param("category");
  const file = c.req.param("file");
  try {
    validateCategory(category);
    const filePath = getSharedAssetPath(category, file);
    const data = await readFile(filePath);
    const mime = getMimeType(filePath);
    const isMedia = mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/");
    return new Response(data, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": isMedia ? "inline" : `attachment; filename="${encodeURIComponent(sanitizeFilename(file))}"`,
      },
    });
  } catch (e: any) {
    if (e.code === "ENOENT") return c.json({ error: "File not found" }, 404);
    if (e.message?.includes("Invalid")) return c.json({ error: e.message }, 400);
    return c.json({ error: "Failed to read file" }, 500);
  }
});

apiRoutes.post("/api/shared-assets/move", async (c) => {
  try {
    const { from, to, file } = await c.req.json<{ from: string; to: string; file: string }>();
    if (!from || !to || !file) return c.json({ error: "from, to, and file are required" }, 400);
    await moveSharedAsset(from, to, file);
    return c.json({ moved: true, from, to, file });
  } catch (e: any) {
    if (e.code === "ENOENT") return c.json({ error: "File not found" }, 404);
    if (e.message?.includes("Invalid")) return c.json({ error: e.message }, 400);
    if (e.message?.includes("already exists")) return c.json({ error: e.message }, 409);
    return c.json({ error: e.message ?? "Move failed" }, 500);
  }
});

apiRoutes.post("/api/shared-assets/:category", async (c) => {
  const category = c.req.param("category");
  try {
    validateCategory(category);
  } catch {
    return c.json({ error: `Invalid category: ${category}` }, 400);
  }
  try {
    const body = await c.req.parseBody({ all: true });
    const files = Array.isArray(body["file"]) ? body["file"] : body["file"] ? [body["file"]] : [];
    const uploaded = [];
    for (const f of files) {
      if (!(f instanceof File)) continue;
      if (f.size > 100 * 1024 * 1024) return c.json({ error: `File ${f.name} exceeds 100MB limit` }, 400);
      const buf = Buffer.from(await f.arrayBuffer());
      const asset = await saveSharedAsset(category, f.name, buf);
      uploaded.push({ ...asset, url: `/api/shared-assets/${category}/${encodeURIComponent(asset.name)}` });
    }
    if (uploaded.length === 0) return c.json({ error: "No files provided" }, 400);
    return c.json({ uploaded });
  } catch (e: any) {
    return c.json({ error: e.message ?? "Upload failed" }, 500);
  }
});

apiRoutes.delete("/api/shared-assets/:category/:file", async (c) => {
  const category = c.req.param("category");
  const file = c.req.param("file");
  try {
    await deleteSharedAsset(category, file);
    return c.json({ deleted: true });
  } catch (e: any) {
    if (e.code === "ENOENT") return c.json({ error: "File not found" }, 404);
    if (e.message?.includes("Invalid")) return c.json({ error: e.message }, 400);
    return c.json({ error: "Delete failed" }, 500);
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
      `1. **焦虑**（落后焦虑/错过焦虑/被替代焦虑/身份下坠焦虑）— 让观众觉得"我是不是落后了"`,
      `2. **愤怒**（不公/冒犯/双标/欺骗/价值观冲突）— 让观众觉得"这不对/凭什么"`,
      `3. **搞笑/抽象**（反转/共鸣/错位）— 让观众笑出来想转发`,
      `4. **羡慕**（想成为/想拥有）— 让观众觉得"我也想要这样的生活"`,
      ``,
      `每个话题必须在 JSON 中标注 "emotionType"（焦虑/愤怒/搞笑/羡慕）和 "emotionSubtype"（具体子类型）。`,
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
      `  "emotionType":"焦虑",`,
      `  "emotionSubtype":"被替代焦虑",`,
      `  "description":"趋势描述和为什么值得做",`,
      `  "tags":["推荐标签1","推荐标签2","推荐标签3"],`,
      `  "contentAngles":["切入角度1","切入角度2"],`,
      `  "exampleHook":"爆款开头示例",`,
      `  "category":"所属领域"`,
      `}]}`,
      `- topics 至少 10 个`,
      `- heat 为 1-5 整数，competition 为 "低"/"中"/"高"`,
      `- opportunity 为 "金矿"(高热低竞)/"蓝海"(低热低竞)/"红海"(高热高竞)`,
      `- emotionType 必填，为 "焦虑"/"愤怒"/"搞笑"/"羡慕" 之一`,
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

    const steps = Object.entries(work.pipeline);
    const pendingStep = steps.find(([, s]) => s.status === "pending" || s.status === "active");
    const stepName = pendingStep ? pendingStep[1].name : steps[0]?.[1]?.name ?? "创作";

    const prompt = [
      `你是一个内容创作助手。你正在帮助用户创作: "${work.title}" (类型: ${work.type})。`,
      `目标平台: ${work.platforms.map((p: any) => typeof p === "string" ? p : p.platform).join(", ")}。`,
      work.topicHint ? `选题方向: ${work.topicHint}` : "",
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

    // Check prerequisites: all preceding steps must be done/skipped
    const stepKeys = Object.keys(work.pipeline);
    const stepIdx = stepKeys.indexOf(step);
    for (let i = 0; i < stepIdx; i++) {
      const prev = work.pipeline[stepKeys[i]];
      if (prev.status !== "done" && prev.status !== "skipped") {
        return c.json({ error: `Previous step "${prev.name}" is not completed` }, 400);
      }
    }

    const promptParts = [
      `You are working on a content piece: "${work.title}" (type: ${work.type}).`,
      work.contentCategory ? `Content category: ${work.contentCategory}.` : "",
      `Platforms: ${work.platforms.map((p: any) => typeof p === "string" ? p : p.platform).join(", ")}.`,
      work.topicHint ? `Topic hint: ${work.topicHint}` : "",
      ``,
    ];

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
    } else if (step === "research" && work.contentCategory && work.contentCategory !== "comedy") {
      const emotionEffect: Record<string, string> = {
        anxiety: "看完之后感到焦虑、危机感、害怕自己落后或错过",
        conflict: "看完之后感到愤怒、不公、想站队、想在评论区吵架",
        envy: "看完之后感到羡慕、向往、想收藏、想拥有同样的生活",
      };
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
        envy: [
          `路线1 反差跃迁型：before/after 两张搜图 + 文案强调路径短`,
          `路线2 关系羡慕型：1-5张甜蜜瞬间搜图（风格统一）+ 一句话文案`,
          `路线3 隐性阶层信号型：1-5张日常搜图（细节暗示阶层）+ 轻描淡写文案`,
        ].join("\n"),
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
    } else {
      promptParts.push(
        `Execute the "${pipelineStep.name}" step of the pipeline.`,
        `Produce output appropriate for this step. Be thorough and creative.`,
      );
      if (step === "assets" && work.type === "short-video") {
        promptParts.push(
          ``,
          `## Asset Acquisition Strategy`,
          `For this step, you should acquire video materials by **downloading real clips from the internet** using yt-dlp.`,
          `Do NOT use AI generation APIs unless the user explicitly requests it.`,
          ``,
          `### Workflow:`,
          `1. Read the storyboard/plan from the previous step to understand what clips are needed`,
          `2. For each shot, construct search keywords based on the scene description`,
          `3. Search YouTube/Bilibili: \`yt-dlp "ytsearch5:keywords" --get-title --get-url --get-duration\``,
          `4. Download best quality: \`yt-dlp -f "bestvideo[height<=1080]+bestaudio/best" --merge-output-format mp4 -o "clips/clip-NN.mp4" "URL"\``,
          `5. Trim to needed segment: \`ffmpeg -i clip.mp4 -ss START -to END -c copy -y trimmed.mp4\``,
          `6. Verify audio exists: \`ffprobe -v error -show_entries stream=codec_type -of csv=p=0 clip.mp4 | grep audio\``,
          ``,
          `Read the SKILL.md section "素材获取方式：全网搜索下载" for full details.`,
          `Save all clips to the work assets directory under clips/.`,
        );
      }
      if (step === "assembly" && work.type === "short-video") {
        promptParts.push(
          ``,
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
        anxiety: "焦虑 (anxiety/crisis). Read modules/emotional-hooks.md and apply the 焦虑 emotion rules. For image-text, use one of the 3 mandatory routes (观点输出/对话截图/清单盘点).",
        conflict: "愤怒 (conflict/debate). Read modules/emotional-hooks.md and apply the 愤怒 emotion rules. For image-text, use one of the 3 mandatory routes (观点输出/对话截图/清单盘点).",
        comedy: "搞笑/抽象 (comedy/abstract). Read genres/comedy.md and apply its rules to this step.",
        envy: "羡慕 (aspiration/envy). Read modules/emotional-hooks.md and apply the 羡慕 emotion rules. For image-text, use one of the 3 mandatory routes (反差跃迁/关系羡慕/隐性阶层信号).",
      };
      const emotionDirective = emotionMap[work.contentCategory as string];
      if (emotionDirective) {
        promptParts.push(
          ``,
          `## IMPORTANT: Target emotion for this content is ${emotionDirective}`,
        );
        // Additional comedy-specific directives
        if (work.contentCategory === "comedy") {
          promptParts.push(
            `## IMPORTANT: This is comedy/abstract content (搞笑/抽象类).`,
            `You MUST read the genres/comedy.md file in the current step's skill directory and apply its rules.`,
          );
          const comedyByStep: Record<string, string> = {
            research: [
              `For the research step, focus on:`,
              `- Finding trending comedy/abstract topics, memes, and formats on the target platform`,
              `- Analyzing what reversal types (经典反转/递进荒诞/错位/重复打破/平行对比/紧张崩塌/微观共鸣) are currently performing well`,
              `- For abstract content: which "mismatch dimensions" (感官错配/过度认真/过度随意/语境位移/形式解构/真实解构/平行宇宙) are trending`,
              `- Identifying comedy hooks and BGM trends`,
            ].join("\n"),
            plan: [
              `For the planning step, the script/storyboard MUST follow the comedy genre rules (see genres/comedy.md):`,
              `- Choose a specific structure from the 7 comedy types or 7 abstract types in the skill`,
              `- Design the Hook (first 3 seconds) using the Hook types table`,
              `- Write dialogue following the comedy dialogue rules (短句为王, 口语化, 留白)`,
              `- Plan BGM strategy (情绪铺垫反转 / 卡点强化 / 反差配乐 / 梗音乐)`,
              `- Plan sound effects at key moments (反转点必须有声音标记)`,
              `- For abstract content: define the two "mismatch dimensions" and ensure purity of each extreme`,
              `- Run the 爆款自检清单 before finalizing`,
            ].join("\n"),
            assembly: [
              `For the assembly step, you handle BOTH asset generation AND editing/compositing.`,
              ``,
              `### Editing & Compositing:`,
              `- Editing rhythm: normal during setup, sudden change at reversal point`,
              `- BGM must have a sound marker at the reversal point (静音/音效/换曲)`,
              `- Jump cuts for comedy, longer takes for abstract`,
              `- Add sound effects precisely (急刹车 at reversals, 静音0.3-0.5s before twists)`,
              `- For abstract: consider using silence instead of sound effects to maintain the "dead serious" tone`,
              `- Volume: dialogue 100%, BGM 15-25% during speech, 40-60% during visual-only`,
              ``,
              `### Available Scripts (MUST USE, do NOT write inline code):`,
              `- **BGM search**: Read \`modules/music-search.md\` for yt-dlp search/download workflow`,
              `- **Beat detection**: \`python3 ~/.claude/skills/content-assembly/scripts/beat-sync/detect_beats.py bgm.mp3 -o beats.json\``,
              `- **Beat-sync editing**: \`python3 ~/.claude/skills/content-assembly/scripts/beat-sync/beat_sync_edit.py --video source.mp4 --music bgm.mp3 --output final.mp4 --style dramatic\``,
              `- Read \`modules/beat-sync.md\` for detailed usage of 3 styles (fast/smooth/dramatic)`,
            ].join("\n"),
          };
          const comedyDirective = comedyByStep[step];
          if (comedyDirective) promptParts.push(comedyDirective);
        }
      }

      // For image-text assets step: enforce correct asset acquisition method per category
      if (step === "assets" && work.type === "image-text") {
        const assetMethod: Record<string, string> = {
          envy: [
            ``,
            `## 严禁 AI 生图！严禁 ffmpeg 生成文字卡片！所有图片（包括封面）必须从网上搜索下载真实照片`,
            ``,
            `"向往拥有/羡慕"类图文的**所有图片（封面图 + 内容图）**都必须是从网上搜索下载的真实照片。`,
            `- ❌ 禁止使用 AI 生成图片`,
            `- ❌ 禁止使用 ffmpeg 生成文字卡片作为封面`,
            `- ✅ 封面图也必须是真实照片——看似普通，但细节透露"中产以上层级"的照片`,
            ``,
            `### 封面图要求`,
            `通过细节（不是直接展示奢侈品）传达阶层信号：`,
            `- 地点：某个特定区域/场所（独立咖啡馆、大落地窗客厅、安静的街区）`,
            `- 时间：工作日白天在做某件悠闲的事（暗示不用上班）`,
            `- 行为：不赶时间、从容不迫的状态`,
            `照片风格：像 iPhone 随手拍的，自然光线，构图不能太精心，不能有摆拍痕迹。`,
            ``,
            `### 图2-5 要求`,
            `每张图内容不同，但**风格、清晰度、色调、画风必须完全一致**，像同一部手机同一天拍的。`,
            ``,
            `### 执行步骤`,
            `1. 从内容规划方案中提取每张图的搜图关键词（关键词要具体到场景细节）`,
            `2. 所有搜图关键词加上统一的风格限定词（如"自然光 手机拍摄 日常 真实"）`,
            `3. 用 WebSearch 搜索对应的图片`,
            `4. 用 curl 下载找到的图片，保存到作品的 assets/images/ 目录`,
            `5. 下载后用 ffmpeg 统一调色（亮度/对比度/色温），消除不同来源的色差`,
            `6. 如果某张图风格偏离太大，弃用重搜，不要强行调色凑数`,
            ``,
            `参考 modules/emotional-hooks.md 中羡慕类的素材生成指令获取详细规则。`,
          ].join("\n"),
          anxiety: [
            ``,
            `## 图片生成方式`,
            ``,
            `"危机感/焦虑"类图文：只有封面是文字卡片（用 ffmpeg 生成）。`,
            `**除封面外的其他图片禁止写文字观点！** 文字观点全部在文案正文里体现。`,
            `其余配图用与话题相关的真实照片（全网搜索下载）。`,
            `如果方案使用的是路线2（对话截图型），对话截图仅限封面，其余图用真实照片。`,
            `参考 modules/emotional-hooks.md 中焦虑类的素材生成指令。`,
          ].join("\n"),
          conflict: [
            ``,
            `## 图片生成方式`,
            ``,
            `"观点分歧/愤怒"类图文：只有封面是文字卡片（用 ffmpeg 生成）。`,
            `**除封面外的其他图片禁止写文字观点！** 文字观点全部在文案正文里体现。`,
            `其余配图用与话题相关的真实照片（全网搜索下载）。`,
            `如果方案使用的是路线2（对话截图型），对话截图仅限封面，其余图用真实照片。`,
            `参考 modules/emotional-hooks.md 中焦虑类的素材生成指令。`,
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

// ── Evaluation helpers ──────────────────────────────────────────────────────

function broadcastPipelineUpdate(workId: string, pipeline: Record<string, PipelineStep>): void {
  if (!wsBridge) return;
  const session = wsBridge.getSession(workId);
  if (!session) return;
  for (const ws of session.browserSockets) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        event: "pipeline_updated",
        data: { workId, pipeline },
        timestamp: new Date().toISOString(),
      }));
    }
  }
}

async function waitForCreatorIdle(workId: string, timeoutMs = 120_000): Promise<void> {
  if (!wsBridge) return;
  const session = wsBridge.getSession(workId);
  if (!session) return;

  // If creator CLI is still running, wait for it to exit
  if (session.cliProcess) {
    log("info", "api", "eval_waiting_for_creator", workId, {});
    const start = Date.now();
    await new Promise<void>((resolve) => {
      const check = () => {
        if (!session.cliProcess || Date.now() - start > timeoutMs) {
          resolve();
          return;
        }
        setTimeout(check, 500);
      };
      // Listen for the process exit directly if possible
      if (session.cliProcess) {
        session.cliProcess.once("exit", () => {
          // Give a small delay for final messages to flush
          setTimeout(resolve, 1000);
        });
        // Fallback timeout
        setTimeout(check, 500);
      } else {
        resolve();
      }
    });
    log("info", "api", "eval_creator_idle", workId, { waitedMs: Date.now() - start });
  }
}

async function runEvaluation(workId: string, completedStep: string, nextStep?: string): Promise<void> {
  if (!wsBridge) throw new Error("WsBridge not initialized");

  // CRITICAL: Wait for creator agent's CLI process to finish before starting evaluator
  // The creator calls pipeline/advance as a tool use during its turn — we must not
  // start the evaluator until the creator's turn is fully complete to avoid interleaved output.
  await waitForCreatorIdle(workId);

  const work = await getWork(workId);
  if (!work) throw new Error("Work not found");

  const session = wsBridge.ensureSession(workId);
  session.evalStep = completedStep;

  const attempt = (work.evalAttempts?.[completedStep] ?? 0) + 1;

  // Load step history for context
  const stepHistory = await loadStepHistory(workId, completedStep);
  const historyText = (stepHistory as any)?.blocks
    ?.filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n\n")
    .slice(0, 8000) ?? "";

  // Load previous eval results
  const prevResults = await loadAllEvalResults(workId, completedStep);
  const prevResultsText = prevResults.length > 0
    ? prevResults.map(r => `第${r.attempt}轮评审: ${r.verdict}\n问题: ${r.issues.map(i => i.description).join("; ")}\n建议: ${r.suggestions.join("; ")}`).join("\n\n")
    : "";

  // Build evaluator prompt
  const evalPrompt = buildEvalPrompt(work, completedStep, attempt, historyText, prevResultsText);

  // Broadcast eval_divider start
  session.messageHistory.push({
    type: "eval_divider" as any,
    text: `评审开始 (第${attempt}轮)`,
    source: "evaluator",
    timestamp: new Date().toISOString(),
  });
  wsBridge.broadcastToBrowsers(workId, {
    event: "eval_divider",
    data: { type: "start", step: completedStep, attempt },
  });

  // Spawn evaluator (resume if same step has prior session)
  const resumeId = work.evalSessionIds?.[completedStep];
  try {
    const evalResult = await wsBridge.spawnEvaluator(session, evalPrompt, resumeId);
    evalResult.step = completedStep;
    evalResult.attempt = attempt;
    evalResult.timestamp = new Date().toISOString();

    // Save result
    await saveEvalResult(workId, completedStep, attempt, evalResult);

    // Update attempts
    const evalAttempts = { ...(work.evalAttempts ?? {}), [completedStep]: attempt };
    // Also persist evalSessionId
    const evalSessionIds = { ...(work.evalSessionIds ?? {}), [completedStep]: session.evalSessionId ?? "" };
    await storeUpdateWork(workId, { evalAttempts, evalSessionIds } as any);

    if (evalResult.verdict === "pass") {
      // PASS — advance pipeline
      session.messageHistory.push({
        type: "eval_divider" as any,
        text: "评审通过 ✓",
        source: "evaluator",
        timestamp: new Date().toISOString(),
      });
      wsBridge.broadcastToBrowsers(workId, {
        event: "eval_divider",
        data: { type: "end", step: completedStep, verdict: "pass", scores: evalResult.scores },
      });

      // Clean up eval session for this step
      const cleanedEvalSessionIds = { ...evalSessionIds };
      delete cleanedEvalSessionIds[completedStep];

      const freshWork = await getWork(workId);
      if (freshWork) {
        freshWork.pipeline[completedStep].status = "done";
        freshWork.pipeline[completedStep].completedAt = new Date().toISOString();
        if (nextStep && freshWork.pipeline[nextStep]) {
          freshWork.pipeline[nextStep].status = "active";
          freshWork.pipeline[nextStep].startedAt = new Date().toISOString();
        }
        await storeUpdateWork(workId, {
          pipeline: freshWork.pipeline,
          evalSessionIds: cleanedEvalSessionIds,
          evalAttempts: { ...(freshWork.evalAttempts ?? {}), [completedStep]: 0 },
        } as any);
        broadcastPipelineUpdate(workId, freshWork.pipeline);
      }

      // Persist chat
      saveWorkChat(workId, { blocks: session.messageHistory }).catch(() => {});

      // Auto-resume creator agent to continue with next step
      if (nextStep) {
        const continuePrompt = `评审已通过，pipeline 已自动推进到「${freshWork?.pipeline[nextStep]?.name ?? nextStep}」阶段。请继续执行该阶段的工作。`;
        await wsBridge.sendMessage(workId, continuePrompt);
      }
    } else {
      // FAIL — send feedback to creator agent
      session.messageHistory.push({
        type: "eval_divider" as any,
        text: `评审未通过 ✗ (${evalResult.issues.length}个问题)`,
        source: "evaluator",
        timestamp: new Date().toISOString(),
      });
      wsBridge.broadcastToBrowsers(workId, {
        event: "eval_divider",
        data: { type: "end", step: completedStep, verdict: "fail", scores: evalResult.scores, issues: evalResult.issues },
      });

      // Check iteration limit
      if (attempt >= 3) {
        const freshWork = await getWork(workId);
        if (freshWork) {
          freshWork.pipeline[completedStep].status = "eval_blocked" as any;
          await storeUpdateWork(workId, { pipeline: freshWork.pipeline });
          broadcastPipelineUpdate(workId, freshWork.pipeline);
        }
        wsBridge.broadcastToBrowsers(workId, {
          event: "eval_blocked",
          data: { workId, step: completedStep, attempt, result: evalResult },
        });
        saveWorkChat(workId, { blocks: session.messageHistory }).catch(() => {});
        return;
      }

      // Set step back to active
      const freshWork = await getWork(workId);
      if (freshWork) {
        freshWork.pipeline[completedStep].status = "active";
        await storeUpdateWork(workId, { pipeline: freshWork.pipeline });
        broadcastPipelineUpdate(workId, freshWork.pipeline);
      }

      // Inject feedback into creator agent via resume
      const feedbackPrompt = buildFeedbackPrompt(evalResult, attempt);
      await wsBridge.sendMessage(workId, feedbackPrompt);

      // Persist chat
      saveWorkChat(workId, { blocks: session.messageHistory }).catch(() => {});
    }
  } catch (err) {
    log("error", "api", "eval_error", workId, { error: (err as Error).message });
    // On evaluator failure, revert to active
    const freshWork = await getWork(workId);
    if (freshWork) {
      freshWork.pipeline[completedStep].status = "active";
      await storeUpdateWork(workId, { pipeline: freshWork.pipeline });
      broadcastPipelineUpdate(workId, freshWork.pipeline);
    }
  }
}

function buildFeedbackPrompt(evalResult: EvalResult, attempt: number): string {
  const issueList = evalResult.issues
    .map((i, idx) => `${idx + 1}. [${i.severity}] ${i.description}${i.file ? ` (文件: ${i.file})` : ""}`)
    .join("\n");
  const suggestionList = evalResult.suggestions
    .map((s, idx) => `${idx + 1}. ${s}`)
    .join("\n");

  return `## 评审反馈 (第${attempt}轮)

评审未通过，请根据以下反馈修复问题后重新提交：

### 问题列表
${issueList}

### 修改建议
${suggestionList}

请修复以上问题，修复完成后再次调用 pipeline/advance 提交评审。`;
}

function buildEvalPrompt(work: Work, step: string, attempt: number, historyText: string, prevResultsText: string): string {
  const stepName = work.pipeline[step]?.name ?? step;
  const platforms = work.platforms?.join(", ") ?? "未指定";

  return `你是一位严格的内容质量评审专家。你的任务是审查「${work.title}」的「${stepName}」阶段产出。

## 你的角色
- 你是独立的评审者，不是创作者。你的职责是发现问题，而不是赞美。
- AI 存在"自我评价偏差"——倾向于赞美自己的产出。你必须刻意克服这种倾向。
- 使用硬性阈值，不要模糊通过。任何维度低于 6/10 分必须打回。

## 作品信息
- 标题: ${work.title}
- 类型: ${work.type}
- 平台: ${platforms}
- 当前阶段: ${stepName}
- 评审轮次: 第${attempt}轮

## 评审标准
请阅读 skills/content-evaluator/criteria/${step}.md 获取该阶段的详细评审标准。如果文件不存在，请使用通用的内容质量标准进行评审。

## 创作产出摘要
${historyText.slice(0, 6000) || "(无文本产出记录)"}

## 评审指令
1. 检查作品目录下的实际文件
2. 对于图片文件：使用 Read 工具查看图片，评估视觉质量
3. 对于视频文件：使用 ffprobe 检查技术参数（分辨率、时长、编码、音频轨）
4. 根据评审标准逐项评分
5. 输出结构化评审结果

${prevResultsText ? `## 历史评审记录\n${prevResultsText}\n\n请特别关注之前指出的问题是否已修复。不要重复提出已修复的问题。` : ""}

## 输出格式（必须严格遵循）

在你的分析之后，输出以下 JSON 代码块：

\`\`\`json
{
  "verdict": "pass" 或 "fail",
  "scores": {
    "维度1": 1-10,
    "维度2": 1-10
  },
  "issues": [
    {"severity": "critical/major/minor", "description": "问题描述", "file": "相关文件路径（可选）"}
  ],
  "suggestions": ["修改建议1", "修改建议2"]
}
\`\`\`

规则：
- 任何 critical 问题 → 必须 fail
- 任何维度 < 6/10 → 必须 fail
- 所有维度 ≥ 7/10 且无 critical 问题 → pass`;
}

// POST /api/works/:id/pipeline/advance — agent calls this to advance pipeline
apiRoutes.post("/api/works/:id/pipeline/advance", async (c) => {
  const id = c.req.param("id");
  try {
    const body = await c.req.json<{ completedStep: string; nextStep?: string }>().catch(() => ({} as any));
    log("info", "api", "pipeline_advance", id, { completedStep: body.completedStep, nextStep: body.nextStep });
    const work = await getWork(id);
    if (!work) return c.json({ error: "Work not found" }, 404);

    const { completedStep, nextStep } = body;
    if (!completedStep) return c.json({ error: "completedStep is required" }, 400);

    // ── Evaluation gate ─────────────────────────────────────────────────
    if (work.evaluationMode && work.pipeline[completedStep]?.status !== "evaluating") {
      work.pipeline[completedStep].status = "evaluating" as any;
      await storeUpdateWork(id, { pipeline: work.pipeline });
      broadcastPipelineUpdate(id, work.pipeline);

      // Start evaluation asynchronously (don't await — return immediately)
      runEvaluation(id, completedStep, nextStep).catch((err) => {
        log("error", "api", "eval_failed", id, { error: (err as Error).message });
      });

      return c.json({ ok: true, evaluating: true, pipeline: work.pipeline });
    }

    // ── Normal advance (eval off or already passed) ─────────────────────
    if (work.pipeline[completedStep]) {
      work.pipeline[completedStep].status = "done";
      work.pipeline[completedStep].completedAt = new Date().toISOString();
    }

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

    if (nextStep && work.pipeline[nextStep]) {
      work.pipeline[nextStep].status = "active";
      work.pipeline[nextStep].startedAt = new Date().toISOString();
    }

    await storeUpdateWork(id, { pipeline: work.pipeline });

    // Memory sync (keep existing logic)
    if (completedStep) {
      loadStepHistory(id, completedStep).then(history => {
        const h = history as { blocks?: { type: string; text: string }[] } | null;
        if (h?.blocks) {
          getWork(id).then(w => {
            syncStepConversation(
              id, w?.title ?? "Untitled", completedStep,
              w?.pipeline?.[completedStep]?.name ?? completedStep, h.blocks!,
            ).catch(() => {});
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    broadcastPipelineUpdate(id, work.pipeline);
    return c.json({ ok: true, pipeline: work.pipeline });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Pipeline advance error" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Evaluation API endpoints
// ---------------------------------------------------------------------------

// POST /api/works/:id/eval/toggle
apiRoutes.post("/api/works/:id/eval/toggle", async (c) => {
  const id = c.req.param("id");
  const work = await getWork(id);
  if (!work) return c.json({ error: "Work not found" }, 404);
  const newMode = !(work.evaluationMode ?? false);
  await storeUpdateWork(id, { evaluationMode: newMode } as any);
  return c.json({ ok: true, evaluationMode: newMode });
});

// POST /api/works/:id/eval/force-pass
apiRoutes.post("/api/works/:id/eval/force-pass", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ step: string; nextStep?: string }>().catch(() => ({} as any));
  const work = await getWork(id);
  if (!work) return c.json({ error: "Work not found" }, 404);
  const { step, nextStep } = body;
  if (!step || !["eval_blocked", "evaluating"].includes(work.pipeline[step]?.status as string)) {
    return c.json({ error: "Step not in eval_blocked/evaluating state" }, 400);
  }
  work.pipeline[step].status = "done";
  work.pipeline[step].completedAt = new Date().toISOString();
  if (nextStep && work.pipeline[nextStep]) {
    work.pipeline[nextStep].status = "active";
    work.pipeline[nextStep].startedAt = new Date().toISOString();
  }
  await storeUpdateWork(id, { pipeline: work.pipeline });
  broadcastPipelineUpdate(id, work.pipeline);
  return c.json({ ok: true, pipeline: work.pipeline });
});

// POST /api/works/:id/eval/retry
apiRoutes.post("/api/works/:id/eval/retry", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ step: string; guidance: string }>().catch(() => ({} as any));
  const work = await getWork(id);
  if (!work) return c.json({ error: "Work not found" }, 404);
  const { step, guidance } = body;
  if (!step) return c.json({ error: "step required" }, 400);
  work.pipeline[step].status = "active";
  const evalAttempts = { ...(work.evalAttempts ?? {}), [step]: 0 };
  await storeUpdateWork(id, { pipeline: work.pipeline, evalAttempts } as any);
  broadcastPipelineUpdate(id, work.pipeline);
  if (wsBridge && guidance) {
    await wsBridge.sendMessage(id, `## 用户指导\n\n${guidance}\n\n请根据以上指导修改当前阶段的产出，完成后重新提交。`);
  }
  return c.json({ ok: true });
});

// GET /api/works/:id/eval/results/:step
apiRoutes.get("/api/works/:id/eval/results/:step", async (c) => {
  const id = c.req.param("id");
  const step = c.req.param("step");
  const results = await loadAllEvalResults(id, step);
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

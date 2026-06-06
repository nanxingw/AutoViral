// Trends domain sub-router (I11): trend data + report + cover serving, the
// manual refresh, the WsBridge-driven streaming research, and session cancel.
// Split verbatim from api.ts — no behaviour/path change.

import { Hono } from "hono";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { loadConfig } from "../../infra/config.js";
import { isKnownPlatform, type Platform } from "../../trends/schema.js";
import { rankByInterests } from "../../trends/ranking.js";
import { getWsBridge, runTrendScript, researchTrends } from "./_shared.js";

export const trendsRouter = new Hono();

// S14/B2 — a row is "stale" once its collectedAt is older than this. The data
// page S5 collectors are best-effort; serving month-old trends as if they were
// live current热门 was the entire B2/#82 trust-collapse story. We expose the age
// honestly so the panel can badge it, never silently pretend it is live.
const STALE_AFTER_DAYS = 7;

function freshness(collectedAt: string): { collectedAt: string; ageDays: number; stale: boolean } {
  const at = Date.parse(collectedAt);
  if (!Number.isFinite(at)) return { collectedAt, ageDays: 0, stale: false };
  const ageDays = Math.max(0, Math.floor((Date.now() - at) / 86_400_000));
  return { collectedAt, ageDays, stale: ageDays > STALE_AFTER_DAYS };
}

// GET /api/trends/:platform — return latest trend data (prefer data.json, fall back to YAML)
trendsRouter.get("/api/trends/:platform", async (c) => {
  const platform = c.req.param("platform");
  // B2/B6 — allow-list the path segment BEFORE it ever touches the filesystem.
  // An unknown / traversal value (`../`, `bogus`) can't be a known Platform, so
  // it short-circuits to an honest 404 with no disk access.
  if (!isKnownPlatform(platform)) return c.json({ error: "Unknown platform" }, 404);
  const trendsDir = join(homedir(), ".autoviral", "trends", platform);
  // #49 — normalize legacy `{topics}` payloads to the `{items}` schema the
  // frontend reads, at this single GET exit so every consumer benefits.
  const { normalizeTrendsPayload } = await import("../../trends/normalize.js");

  // S14 — rank by fit-to-channel (config.interests) and stamp freshness, in one
  // shared exit so both the data.json and YAML branches stay honest + ranked.
  const config = await loadConfig();
  const interests = (config.interests ?? []) as string[];
  const finalize = (data: unknown, collectedAtFallback: string) => {
    const norm = normalizeTrendsPayload(data, platform, collectedAtFallback) as {
      items?: unknown[];
      collectedAt?: string;
    };
    if (norm && Array.isArray(norm.items)) {
      norm.items = rankByInterests(norm.items as never[], interests);
    }
    const fresh = freshness(
      typeof norm?.collectedAt === "string" ? norm.collectedAt : collectedAtFallback,
    );
    return { ...norm, ...fresh };
  };

  // Try data.json first (written by agent)
  try {
    const raw = await readFile(join(trendsDir, "data.json"), "utf-8");
    return c.json(finalize(JSON.parse(raw), new Date().toISOString()) as object);
  } catch { /* fall through */ }

  // Fall back to dated YAML files. e2e-report F184: skip underscore-prefixed
  // names (`__sample-*.yaml`, `__fixture-*.yaml`) so dev fixtures from
  // scripts/sample-trend.cjs can't shadow real collected research data.
  // Demo data leaking into /explore as if it were real was the entire R75
  // trust-collapse story; an honest 404 → empty state is far safer than fake
  // "Hook example N" content masquerading as scraper output.
  try {
    const files = await readdir(trendsDir);
    const yamlFiles = files
      .filter(f => f.endsWith(".yaml") && !f.startsWith("_") && !f.startsWith("."))
      .sort()
      .reverse();
    if (yamlFiles.length === 0) return c.json({ error: "No trend data available" }, 404);
    const raw = await readFile(join(trendsDir, yamlFiles[0]), "utf-8");
    const data = yaml.load(raw);
    // Derive a collectedAt fallback from the dated filename (e.g. 2026-05-11)
    // so legacy topics inherit a plausible timestamp instead of "now".
    const dateMatch = yamlFiles[0].match(/(\d{4}-\d{2}-\d{2})/);
    const fallbackAt = dateMatch
      ? new Date(`${dateMatch[1]}T00:00:00.000Z`).toISOString()
      : new Date().toISOString();
    return c.json(finalize(data, fallbackAt) as object);
  } catch {
    return c.json({ error: "No trend data available" }, 404);
  }
});

// GET /api/trends/:platform/report — return the markdown research report
trendsRouter.get("/api/trends/:platform/report", async (c) => {
  const platform = c.req.param("platform");
  if (!isKnownPlatform(platform)) return c.text("", 404);
  try {
    const reportPath = join(homedir(), ".autoviral", "trends", platform, "report.md");
    const report = await readFile(reportPath, "utf-8");
    return c.text(report);
  } catch {
    return c.text("", 404);
  }
});

// GET /api/trends/:platform/covers/:id — serve cached cover jpg.
// e2e-report follow-up: real cover images replace the 9:16 placeholder.
trendsRouter.get("/api/trends/:platform/covers/:id", async (c) => {
  const platform = c.req.param("platform");
  if (!isKnownPlatform(platform)) return c.body(null, 404);
  const rawId = c.req.param("id");
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) return c.body(null, 400);
  const path = join(homedir(), ".autoviral", "trends", platform, "covers", `${safeId}.jpg`);
  try {
    const buf = await readFile(path);
    c.header("content-type", "image/jpeg");
    c.header("cache-control", "public, max-age=86400");
    return c.body(buf);
  } catch {
    return c.body(null, 404);
  }
});

// POST /api/trends/refresh — trigger research collection
trendsRouter.post("/api/trends/refresh", async (c) => {
  try {
    const body = await c.req.json<{ platforms?: string[] }>().catch(() => ({}));
    const platforms = (body as any).platforms ?? ["youtube", "tiktok", "xiaohongshu", "douyin"];
    const result = await researchTrends(platforms);
    return c.json({ triggered: true, type: "research", ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Collection failed" }, 500);
  }
});

// POST /api/trends/refresh-stream — streaming trend research via WsBridge
trendsRouter.post("/api/trends/refresh-stream", async (c) => {
  const body = await c.req.json<{ platform?: string; interests?: string[]; competitors?: string[] }>().catch(() => ({}));
  // B6 — the caller-controlled platform is used to build `outputDir` and the
  // agent prompt's file paths. Validate it against the known-platform allow-list
  // BEFORE creating any session or path, so an unsupported/`../`-injecting value
  // can never write a stale directory (which B2's GET would then serve as live).
  // This guard precedes the wsBridge check so an illegal platform always 400s
  // (never 503), and nothing is written to disk.
  const rawPlatform: unknown = (body as any).platform ?? "douyin";
  if (!isKnownPlatform(rawPlatform)) {
    return c.json({ error: "Unknown platform" }, 400);
  }
  const platform: Platform = rawPlatform;

  const wsBridge = getWsBridge();
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
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
trendsRouter.post("/api/trends/cancel/:sessionKey", async (c) => {
  const wsBridge = getWsBridge();
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  const sessionKey = c.req.param("sessionKey");
  const killed = wsBridge.killTrendSession(sessionKey);
  return c.json({ cancelled: killed });
});

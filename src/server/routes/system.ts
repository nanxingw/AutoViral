// System domain sub-router (I11): status, config, interests, logs,
// test-runner, memory. Split verbatim from api.ts — no behaviour/path change.

import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import cron from "node-cron";
import { loadConfig, saveConfig } from "../../infra/config.js";
import { restartResearchScheduler } from "../../research-scheduler.js";
import { readLogs } from "../../infra/logger.js";
import { runPipeline, getRunStatus, listRuns, getRunReport, type RunConfig } from "../../test-runner.js";
import { evaluateWork } from "../../test-evaluator.js";
import { MemoryClient } from "../../domain/memory.js";
import { getWork } from "../../domain/work-store.js";
import {
  SECRET_BEARING_KEYS,
  SECRET_FIELDS,
  buildSecretMeta,
  getWsBridge,
} from "./_shared.js";

export const systemRouter = new Hono();

// ── Status & Config ─────────────────────────────────────────────────────────

// GET /api/status
systemRouter.get("/api/status", async (c) => {
  const config = await loadConfig();
  return c.json({
    state: "idle",
    model: config.model,
    port: config.port,
  });
});

// GET /api/config
systemRouter.get("/api/config", async (c) => {
  const config = await loadConfig();
  let analyticsLastCollectedAt: string | null = null;
  try {
    const latestPath = join(homedir(), ".autoviral", "analytics", "douyin", "latest.json");
    const raw = await readFile(latestPath, "utf-8");
    const parsed = JSON.parse(raw);
    analyticsLastCollectedAt = parsed.collected_at ?? null;
  } catch { /* file may not exist; ok */ }
  // #60 — strip EVERY secret-bearing nested object from the spread so no
  // plaintext credential escapes via `...configRest`. Previously only
  // `openrouter` was stripped, leaving jimeng.accessKey/secretKey and
  // memory.apiKey to leak. The redacted values resurface (set/lastFour only)
  // through secretMeta below.
  const configRest = { ...(config as unknown as Record<string, unknown>) };
  for (const k of SECRET_BEARING_KEYS) delete configRest[k];
  return c.json({
    ...configRest,
    // Secret fields: never returned in plaintext. The flat `openrouterKey`
    // stays in the shape (always "") so older clients don't crash on undefined.
    openrouterKey: "",
    secretMeta: buildSecretMeta(config),
    douyinUrl: config.analytics?.douyinUrl ?? "",
    memorySyncEnabled: config.memory?.syncEnabled ?? false,
    researchEnabled: config.research?.enabled ?? false,
    researchCron: config.research?.schedule ?? "7 9,21 * * *",
    analyticsLastCollectedAt,
  });
});

// PUT /api/config
systemRouter.put("/api/config", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const config = await loadConfig();

  // R109 F475 — for SECRET fields, empty string in the body means "I did
  // not type a new value, leave the stored secret alone." This pairs with
  // the GET handler that returns "" for secrets — the draft stays "" until
  // the user types a replacement, and only then does it overwrite.
  const isSecretBlank = (k: (typeof SECRET_FIELDS)[number]) =>
    typeof body[k] === "string" && (body[k] as string) === "";

  // Map flat frontend fields to nested config structure
  if (body.openrouterKey !== undefined && !isSecretBlank("openrouterKey")) {
    config.openrouter = { apiKey: body.openrouterKey as string };
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
  if (body.researchEnabled !== undefined) {
    if (!config.research) config.research = { enabled: true, schedule: "7 9,21 * * *", platforms: ["douyin", "xiaohongshu"] };
    config.research.enabled = body.researchEnabled as boolean;
  }
  if (body.researchCron !== undefined) {
    const cronExpr = String(body.researchCron).trim();
    // #64 — validate BEFORE persisting. An invalid cron would later throw inside
    // cron.schedule and silently kill the research scheduler, leaving the toggle
    // looking healthy while auto-research never fires.
    if (cronExpr && !cron.validate(cronExpr)) {
      return c.json({ error: "Invalid cron expression", errorCode: "invalid_cron" }, 400);
    }
    if (!config.research) config.research = { enabled: true, schedule: "7 9,21 * * *", platforms: ["douyin", "xiaohongshu"] };
    config.research.schedule = cronExpr || "7 9,21 * * *";
  }

  await saveConfig(config);
  // #64 — apply research schedule/enable changes live so the Settings control
  // actually takes effect without a server restart.
  if (body.researchEnabled !== undefined || body.researchCron !== undefined) {
    void restartResearchScheduler();
  }
  return c.json(config);
});

// GET /api/interests — 获取用户兴趣列表
systemRouter.get("/api/interests", async (c) => {
  const config = await loadConfig();
  return c.json({ interests: config.interests ?? [] });
});

// PUT /api/interests — 更新用户兴趣列表
systemRouter.put("/api/interests", async (c) => {
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
// Logs API — structured log viewer
// ---------------------------------------------------------------------------

// GET /api/logs — query structured logs
systemRouter.get("/api/logs", async (c) => {
  const date = c.req.query("date");
  const workId = c.req.query("workId");
  const source = c.req.query("source") as any;
  const level = c.req.query("level") as any;
  const limit = parseInt(c.req.query("limit") ?? "200", 10);

  const entries = await readLogs({ date, workId, source, level, limit });
  return c.json({ entries, count: entries.length });
});

// GET /api/logs/work/:id — all logs for a specific work
systemRouter.get("/api/logs/work/:id", async (c) => {
  const workId = c.req.param("id");
  const entries = await readLogs({ workId, limit: 500 });
  return c.json({ entries, count: entries.length });
});

// ---------------------------------------------------------------------------
// Test Runner API
// ---------------------------------------------------------------------------

// POST /api/test/run — trigger a full pipeline test run
systemRouter.post("/api/test/run", async (c) => {
  const wsBridge = getWsBridge();
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
systemRouter.get("/api/test/status/:runId", async (c) => {
  const runId = c.req.param("runId");
  const run = getRunStatus(runId) ?? await getRunReport(runId);
  if (!run) return c.json({ error: "Run not found" }, 404);
  return c.json(run);
});

// GET /api/test/runs — list all test runs
systemRouter.get("/api/test/runs", async (c) => {
  const runs = await listRuns();
  return c.json({ runs });
});

// GET /api/test/runs/:runId/report — full report
systemRouter.get("/api/test/runs/:runId/report", async (c) => {
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
systemRouter.get("/api/memory/search", async (c) => {
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
systemRouter.get("/api/memory/profile", async (c) => {
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
systemRouter.get("/api/memory/context/:workId", async (c) => {
  const client = await getMemoryClient();
  if (!client) return c.json({ error: "Memory not configured (missing apiKey)" }, 503);
  const workId = c.req.param("workId");
  const work = await getWork(workId);
  if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  const topic = work.topicHint ?? work.title;
  const firstPlatform = work.platforms?.[0];
  const platform = typeof firstPlatform === "string" ? firstPlatform : (firstPlatform as any)?.platform ?? "通用";
  const context = await client.buildContext(topic, platform);
  return c.json({ workId, topic, platform, context });
});

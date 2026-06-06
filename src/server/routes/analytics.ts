// Analytics domain sub-router (I11): aggregate work metrics, creator data +
// history, and the manual Douyin refresh. Split verbatim from api.ts — no
// behaviour/path change.

import { Hono } from "hono";
import { loadConfig } from "../../infra/config.js";
import { listWorks } from "../../domain/work-store.js";
import {
  getLatestCreatorData,
  getCreatorHistory,
  collectData,
  isCollectorAvailable,
  CollectorRunError,
} from "../../domain/analytics-collector.js";
import { generateHonestInsights } from "../../domain/generate-insights.js";
import { runCliBrief } from "../../cli-brief.js";

export const analyticsRouter = new Hono();

// GET /api/analytics — aggregate metrics from all works
analyticsRouter.get("/api/analytics", async (c) => {
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
analyticsRouter.get("/api/analytics/creator", async (c) => {
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
analyticsRouter.get("/api/analytics/creator/history", async (c) => {
  const history = await getCreatorHistory(30)
  return c.json({ history })
})

// GET /api/analytics/insights — PRD-0006 S12. A local agent reads the user's
// real on-disk works and emits candidate "最新洞察"; the output is filtered
// through D3 (insight-guardrail) so anything citing a metric AutoViral never
// measured (retention / 完播 / hook-timing) is rejected. Always 200 with an
// `insights` array — degrades to [] (honest empty state) on any failure rather
// than erroring the page.
analyticsRouter.get("/api/analytics/insights", async (c) => {
  try {
    const insights = await generateHonestInsights({
      getLatestCreatorData,
      // Cheap one-shot agent call; insight synthesis over <=12 short works is
      // fast, so a tighter timeout than the trends default is fine.
      runAgent: (prompt) => runCliBrief(prompt, 60000),
    });
    return c.json({ insights });
  } catch {
    return c.json({ insights: [] });
  }
});

// POST /api/analytics/refresh — manually trigger a real Douyin data collection.
//
// PRD-0006 §D4 / slice S5: the collector is RESTORED (managed-venv f2 +
// browser_cookie3), so this NO LONGER hard-501s. It runs the scrape and maps a
// structured CollectorError → an HTTP status + an `errorCode` the UI localizes
// into an ACTIONABLE prompt (e.g. an expired cookie → 401 collector_relogin →
// "log into douyin.com and close your browser, then retry"), instead of a
// silent empty page. The browser sessionid cookie is read locally by the Python
// script and never leaves the machine.
analyticsRouter.post("/api/analytics/refresh", async (c) => {
  // Honest pre-flight: the managed venv (f2 + browser_cookie3) must be
  // provisioned before a scrape can run. If not, point the user at `autoviral
  // setup` (503) rather than spawning a doomed python3.
  if (!isCollectorAvailable()) {
    return c.json(
      {
        error:
          "Collector dependencies (f2 + browser_cookie3) are not installed. Run `autoviral setup`.",
        errorCode: "collector_not_ready",
      },
      503
    );
  }
  const config = await loadConfig();
  const douyinUrl = config.analytics?.douyinUrl ?? "";
  if (!douyinUrl) {
    return c.json(
      { error: "Douyin URL not configured", errorCode: "douyin_url_missing" },
      400
    );
  }
  try {
    const data = await collectData(douyinUrl);
    return c.json({
      collectedAt: data.collected_at,
      worksCount: data.works.length,
    });
  } catch (err) {
    // Structured collector failure → actionable, localizable error. Auth/cookie
    // failures (needsRelogin) get a distinct code + 401 so the UI shows the
    // "re-login" CTA; everything else is a 500 collect_failed.
    if (err instanceof CollectorRunError) {
      const { code, message, needsRelogin } = err.detail;
      if (needsRelogin) {
        return c.json(
          { error: message, errorCode: "collector_relogin", collectorCode: code },
          401
        );
      }
      const status = code === "DEPENDENCY_ERROR" ? 503 : 500;
      return c.json(
        { error: message, errorCode: "collect_failed", collectorCode: code },
        status
      );
    }
    return c.json(
      { error: String(err), errorCode: "collect_failed" },
      500
    );
  }
});

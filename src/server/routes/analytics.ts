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
} from "../../domain/analytics-collector.js";

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

// POST /api/analytics/refresh — manually trigger a Douyin data collection
analyticsRouter.post("/api/analytics/refresh", async (c) => {
  // #72 — the collector script was removed in the refactor. Tell the client
  // honestly (501 + retired code) instead of spawning a doomed python3 and
  // returning a generic "collect_failed" 500 that the UI swallowed silently.
  if (!isCollectorAvailable()) {
    return c.json(
      {
        error: "Analytics collection was retired in the agentic-terminal refactor.",
        errorCode: "analytics_collection_retired",
      },
      501
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
    if (!data) {
      return c.json(
        { error: "Collection returned no data", errorCode: "collect_failed" },
        500
      );
    }
    return c.json({
      collectedAt: data.collected_at,
      worksCount: data.works.length,
    });
  } catch (err) {
    return c.json(
      { error: String(err), errorCode: "collect_failed" },
      500
    );
  }
});

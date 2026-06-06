import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { WORK_TYPE_IDS } from "@shared/content-types/registry";

// I06 / ADR-006 — mock work-type values derive from the registry ids so the
// fixtures can't drift from the real content-type union.
const [VIDEO, IMAGE_TEXT] = WORK_TYPE_IDS;

export const handlers = [
  http.get("/api/works", () =>
    HttpResponse.json({
      works: [
        { id: "w1", title: "Hook Formula", type: IMAGE_TEXT, status: "published", thumbnail: null, updatedAt: "2026-04-22T10:00:00Z" },
        { id: "w2", title: "Why Nobody Watches", type: VIDEO, status: "published", thumbnail: null, updatedAt: "2026-04-23T10:00:00Z" },
        { id: "w3", title: "Competitor Blind Spots", type: VIDEO, status: "draft", thumbnail: null, updatedAt: "2026-04-24T10:00:00Z" },
      ],
    }),
  ),
  http.post("/api/works", async ({ request }) => {
    const body = (await request.json()) as { title?: string; type?: string; platforms?: string[] };
    if (!body.title || !body.type || !body.platforms) {
      return HttpResponse.json({ error: "title, type, and platforms are required" }, { status: 400 });
    }
    return HttpResponse.json(
      { id: "w-new", title: body.title, type: body.type, status: "draft", thumbnail: null, updatedAt: "2026-04-25T00:00:00Z" },
      { status: 201 },
    );
  }),
  http.get("/api/trends/:platform", ({ params }) =>
    HttpResponse.json({
      platform: params.platform,
      items: [
        {
          id: "t1",
          platform: params.platform,
          title: "POV: cat is chef",
          sourceUrl: "https://example.com/video/1",
          source: "scraper",
          scrapedAt: "2026-04-25T12:00:00Z",
          cover: { url: "https://example.com/thumb/1.jpg", aspect: "9:16" },
          metrics: { views: 45_000_000, likes: 4_200_000, comments: 89_000, shares: null, fetchedAt: "2026-04-25T12:00:00Z" },
          analysis: { heat: 5, competition: "高", opportunity: "红海", description: "Viral cat cooking content", tags: [], contentAngles: [], exampleHook: "", category: "entertainment" },
        },
      ],
      collectedAt: "2026-04-25T12:00:00Z",
      pipelineStatus: "ok",
    }),
  ),
  http.get("/api/analytics/creator", () =>
    HttpResponse.json({
      configured: true,
      data: {
        platform: "douyin",
        account: { nickname: "@alex_creates", follower_count: 342_000, total_favorited: 2_847, aweme_count: 23 },
        works: [],
        // R104 F441 — backend keys are snake_case lifetime averages, not
        // todayLikes/todayComments + per-KPI deltas. The previous fixture
        // hid the adapter mismatch bug; this one matches production shape.
        summary: { total_works_collected: 23, avg_play: 12_400, avg_digg: 2_847, avg_comment: 436, avg_share: 88, avg_collect: 124, engagement_rate: 0.087 },
        demographics: {
          age: { "13-17": 0.08, "18-24": 0.35, "25-34": 0.32, "35-44": 0.15, "45+": 0.10 },
          gender: { male: 0.62, female: 0.38 },
          regions: [
            { name: "United States", pct: 0.28 },
            { name: "China", pct: 0.18 },
          ],
        },
        insights: [{ date: "Mar 14", body: "Competitor gap: tutorial content under-served", tag: "ANGLE" }],
      },
      delta: null,
    }),
  ),
  // PRD-0006 S9 — grounded angle briefs (pure shaper, no LLM). Default to one
  // real-ish trend+interest brief so the Explore page renders a populated card;
  // specific tests override with `mswServer.use(...)`.
  http.get("/api/coach/angle-briefs/:platform", ({ params }) =>
    HttpResponse.json({
      platform: params.platform,
      briefs: [
        {
          id: "brief-0",
          title: "机械键盘 × 露营效率",
          hook: "用你「机械键盘」的视角切入「露营效率」",
          why: "「露营效率」正在上涨，与你「机械键盘」的赛道高度契合。",
          grounding: "trend+interest",
        },
      ],
    }),
  ),
  // PRD-0006 S12 — agent insights endpoint (D3-filtered server-side). Default
  // to empty so the page falls back to the creator-snapshot insights; specific
  // tests override with `mswServer.use(...)`.
  http.get("/api/analytics/insights", () => HttpResponse.json({ insights: [] })),
  http.get("/api/memory/profile", () =>
    HttpResponse.json({ tags: ["High-aesthetic sports blogger", "Data-driven storytelling", "Fast-paced editing"] }),
  ),
  http.get("/api/config", () =>
    HttpResponse.json({
      // R109 F475 — server-side redaction. Plaintext secrets are NEVER
      // returned; secretMeta carries set-flag + last-4 for UI rendering.
      openrouterKey: "",
      secretMeta: {
        openrouterKey: { set: false, lastFour: "" },
      },
      douyinUrl: "",
      researchEnabled: false,
      researchCron: "0 9 * * *",
      model: "sonnet",
      analyticsLastCollectedAt: null,
    }),
  ),
];

export const mswServer = setupServer(...handlers);

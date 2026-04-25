import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export const handlers = [
  http.get("/api/works", () =>
    HttpResponse.json({
      works: [
        { id: "w1", title: "Hook Formula", type: "image-text", status: "published", thumbnail: null, updatedAt: "2026-04-22T10:00:00Z" },
        { id: "w2", title: "Why Nobody Watches", type: "short-video", status: "published", thumbnail: null, updatedAt: "2026-04-23T10:00:00Z" },
        { id: "w3", title: "Competitor Blind Spots", type: "short-video", status: "draft", thumbnail: null, updatedAt: "2026-04-24T10:00:00Z" },
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
        { rank: 1, title: "POV: cat is chef", views: 45_000_000, likes: 4_200_000, comments: 89_000, change: 24, thumbAspect: "9:16" },
      ],
      refreshedAt: "2026-04-25T12:00:00Z",
    }),
  ),
  http.get("/api/analytics/creator", () =>
    HttpResponse.json({
      account: { nickname: "@alex_creates", follower_count: 342_000, total_favorited: 2_847, aweme_count: 23 },
      summary: { todayLikes: 2847, todayComments: 436, engagementRate: 0.087, todayLikesDelta: 0.123, todayCommentsDelta: 0.041, engagementDelta: -0.004 },
      works: [],
      demographics: {
        age: { "13-17": 0.08, "18-24": 0.35, "25-34": 0.32, "35-44": 0.15, "45+": 0.10 },
        gender: { male: 0.62, female: 0.38 },
        regions: [
          { name: "United States", pct: 0.28 },
          { name: "China", pct: 0.18 },
        ],
      },
      insights: [{ date: "Mar 14", body: "Competitor gap: tutorial content under-served", tag: "ANGLE" }],
    }),
  ),
  http.get("/api/memory/profile", () =>
    HttpResponse.json({ tags: ["High-aesthetic sports blogger", "Data-driven storytelling", "Fast-paced editing"] }),
  ),
];

export const mswServer = setupServer(...handlers);

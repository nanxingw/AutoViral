import { describe, it, expect, vi } from "vitest";
import { assembleCoachContext, type CoachContextSources } from "./coach-context.js";
import type { CreatorData } from "./analytics-collector.js";

const creatorData: CreatorData = {
  platform: "douyin",
  collected_at: "2026-03-20T07:00:00Z",
  account: {
    nickname: "tester",
    follower_count: 5,
    following_count: 10,
    total_favorited: 100,
    aweme_count: 9,
  },
  works: [
    { aweme_id: "1", desc: "埃及奇遇 #日常volg", create_time: 1, play_count: 2705, digg_count: 23, comment_count: 0, share_count: 0, collect_count: 3 },
    { aweme_id: "2", desc: "lights on the street #街头穿搭", create_time: 2, play_count: 967, digg_count: 60, comment_count: 0, share_count: 0, collect_count: 2 },
    { aweme_id: "3", desc: "月球战争PV #科幻", create_time: 3, play_count: 581, digg_count: 10, comment_count: 2, share_count: 0, collect_count: 0 },
  ],
  summary: {
    total_works_collected: 3,
    avg_play: 1417,
    avg_digg: 31,
    avg_comment: 0,
    avg_share: 0,
    avg_collect: 1,
    engagement_rate: 0.02,
  },
};

describe("assembleCoachContext", () => {
  it("maps the creator scrape works into coach work inputs (real metrics)", async () => {
    const sources: CoachContextSources = {
      getLatestCreatorData: vi.fn().mockResolvedValue(creatorData),
      getTrendTopics: vi.fn().mockResolvedValue(["秋冬穿搭挑战"]),
      getInterests: vi.fn().mockResolvedValue(["穿搭"]),
    };
    const ctx = await assembleCoachContext("douyin", sources);
    expect(ctx.platform).toBe("douyin");
    expect(ctx.works).toHaveLength(3);
    const egypt = ctx.works.find((w) => w.desc.includes("埃及奇遇"));
    expect(egypt?.playCount).toBe(2705);
    expect(egypt?.diggCount).toBe(23);
    expect(ctx.trendTopics).toEqual(["秋冬穿搭挑战"]);
    expect(ctx.interests).toEqual(["穿搭"]);
  });

  it("degrades honestly to empty works when no scrape exists (no fabrication)", async () => {
    const sources: CoachContextSources = {
      getLatestCreatorData: vi.fn().mockResolvedValue(null),
      getTrendTopics: vi.fn().mockResolvedValue(["城市夜骑"]),
      getInterests: vi.fn().mockResolvedValue([]),
    };
    const ctx = await assembleCoachContext("douyin", sources);
    expect(ctx.works).toEqual([]);
    // trends/interests still ground the coach
    expect(ctx.trendTopics).toEqual(["城市夜骑"]);
  });

  it("survives a trends/interests source error without throwing (empty fallback)", async () => {
    const sources: CoachContextSources = {
      getLatestCreatorData: vi.fn().mockResolvedValue(creatorData),
      getTrendTopics: vi.fn().mockRejectedValue(new Error("no trends on disk")),
      getInterests: vi.fn().mockRejectedValue(new Error("no config")),
    };
    const ctx = await assembleCoachContext("douyin", sources);
    expect(ctx.works).toHaveLength(3);
    expect(ctx.trendTopics).toEqual([]);
    expect(ctx.interests).toEqual([]);
  });
});

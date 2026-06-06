import { describe, it, expect, vi } from "vitest";
import {
  generateHonestInsights,
  type GenerateInsightsDeps,
} from "./generate-insights.js";
import type { CreatorData } from "./analytics-collector.js";

/**
 * S12 orchestrator — read the on-disk works, ask the local agent for insights,
 * filter through D3, shape into UI rows. Deps (works loader + agent runner) are
 * injected so this is testable without disk or a real CLI. D3's own honesty
 * regression lives in insight-guardrail.test.ts; here we prove the wiring:
 * forbidden insights from the agent are dropped, honest ones survive.
 */

const creatorData: CreatorData = {
  platform: "douyin",
  collected_at: "2026-03-20T07:00:00Z",
  account: {
    nickname: "tester",
    follower_count: 5,
    following_count: 10,
    total_favorited: 100,
    aweme_count: 2,
  },
  works: [
    { aweme_id: "1", desc: "埃及奇遇 #日常volg", create_time: 1, play_count: 2705, digg_count: 23, comment_count: 0, share_count: 0, collect_count: 3 },
    { aweme_id: "2", desc: "lights on the street #街头穿搭", create_time: 2, play_count: 967, digg_count: 60, comment_count: 0, share_count: 0, collect_count: 2 },
  ],
  summary: {
    total_works_collected: 2,
    avg_play: 1836,
    avg_digg: 41,
    avg_comment: 0,
    avg_share: 0,
    avg_collect: 2,
    engagement_rate: 0.02,
  },
};

function makeDeps(over: Partial<GenerateInsightsDeps> = {}): GenerateInsightsDeps {
  return {
    getLatestCreatorData: vi.fn().mockResolvedValue(creatorData),
    runAgent: vi.fn().mockResolvedValue("[]"),
    ...over,
  };
}

describe("generateHonestInsights", () => {
  it("passes honest agent insights through and shapes them with a date + tag", async () => {
    const deps = makeDeps({
      runAgent: vi.fn().mockResolvedValue(
        JSON.stringify([
          { body: "埃及奇遇播放 2705 是最高的一条，互动却低，下一条加引导评论的钩子。", tag: "互动", metrics: ["play", "comment"] },
        ]),
      ),
    });
    const out = await generateHonestInsights(deps);
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain("2705");
    expect(out[0].tag).toBe("互动");
    // dated off the scrape's collected_at (truthful provenance, not now())
    expect(out[0].date).toBe("2026-03-20");
  });

  it("DROPS any agent insight that cites a never-measured metric (完播/retention)", async () => {
    const deps = makeDeps({
      runAgent: vi.fn().mockResolvedValue(
        JSON.stringify([
          { body: "你的完播率在科幻类最高。", tag: "风格", metrics: ["play"] },
          { body: "街头穿搭点赞 60 是你点赞最高的方向。", tag: "方向", metrics: ["play", "digg"] },
        ]),
      ),
    });
    const out = await generateHonestInsights(deps);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe("方向");
  });

  it("grounds the agent prompt on the real works (passes them into runAgent)", async () => {
    const runAgent = vi.fn().mockResolvedValue("[]");
    await generateHonestInsights(makeDeps({ runAgent }));
    expect(runAgent).toHaveBeenCalledTimes(1);
    const prompt = runAgent.mock.calls[0][0] as string;
    expect(prompt).toContain("埃及奇遇");
    expect(prompt).toContain("2705");
  });

  it("returns [] without calling the agent when there is no on-disk data (honest, no fabrication)", async () => {
    const runAgent = vi.fn().mockResolvedValue("[]");
    const deps = makeDeps({
      getLatestCreatorData: vi.fn().mockResolvedValue(null),
      runAgent,
    });
    const out = await generateHonestInsights(deps);
    expect(out).toEqual([]);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("returns [] (no throw) when the agent runner fails", async () => {
    const deps = makeDeps({
      runAgent: vi.fn().mockRejectedValue(new Error("claude: command not found")),
    });
    const out = await generateHonestInsights(deps);
    expect(out).toEqual([]);
  });
});

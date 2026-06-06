import { describe, it, expect } from "vitest";
import { shapeAngleBriefs, type AngleBriefContext } from "./angle-briefs.js";
import type { CoachWorkInput } from "./coach-session.js";

function work(desc: string, playCount: number): CoachWorkInput {
  return { desc, playCount, diggCount: 0, commentCount: 0, shareCount: 0, collectCount: 0 };
}

const richCtx: AngleBriefContext = {
  platform: "douyin",
  works: [work("我的咖啡拉花教程", 50000), work("手冲入门", 12000), work("一支随手拍", 3000)],
  trendTopics: ["手冲咖啡新手避坑", "city walk 探店", "极简厨房改造"],
  interests: ["咖啡", "生活方式"],
};

describe("shapeAngleBriefs", () => {
  it("crosses each rising trend with the user's interest (richest grounding)", () => {
    const briefs = shapeAngleBriefs(richCtx, { limit: 3 });
    expect(briefs).toHaveLength(3);
    // first brief = first trend × first interest
    expect(briefs[0].title).toBe("咖啡 × 手冲咖啡新手避坑");
    expect(briefs[0].grounding).toBe("trend+interest");
    // every brief carries a concrete hook + a grounded why
    for (const b of briefs) {
      expect(b.hook.length).toBeGreaterThan(0);
      expect(b.why.length).toBeGreaterThan(0);
      expect(b.id.length).toBeGreaterThan(0);
    }
  });

  it("the why is grounded in a REAL trend title + the platform (not a hard-coded sample)", () => {
    const briefs = shapeAngleBriefs(richCtx, { limit: 1 });
    expect(briefs[0].why).toContain("手冲咖啡新手避坑"); // real trend
    expect(briefs[0].why).toContain("douyin"); // real selected platform
  });

  it("cites the top work's REAL play count only when the sample is not thin", () => {
    const briefs = shapeAngleBriefs(richCtx, { limit: 1 });
    // top work by play = 50000; weak-signal cite uses ONLY the real play metric
    expect(briefs[0].why).toContain("50000");
    expect(briefs[0].why).toContain("我的咖啡拉花教程");
  });

  it("does NOT fabricate per-work precision when works are thin (< 3)", () => {
    const thinCtx: AngleBriefContext = {
      ...richCtx,
      works: [work("唯一一条作品", 999)],
    };
    const briefs = shapeAngleBriefs(thinCtx, { limit: 2 });
    expect(briefs.length).toBeGreaterThan(0);
    // no work title / play count cited from the thin sample
    for (const b of briefs) {
      expect(b.why).not.toContain("999");
      expect(b.why).not.toContain("唯一一条作品");
    }
  });

  it("leans on interests alone (honest) when there is no live trend data", () => {
    const noTrend: AngleBriefContext = { ...richCtx, trendTopics: [] };
    const briefs = shapeAngleBriefs(noTrend, { limit: 2 });
    expect(briefs).toHaveLength(2);
    expect(briefs[0].grounding).toBe("interest");
    expect(briefs[0].title).toContain("咖啡");
    // honest about missing trend data
    expect(briefs[0].why).toContain("趋势");
  });

  it("falls back to ONE honest 'no signal yet' brief with neither trend nor interest", () => {
    const empty: AngleBriefContext = { platform: "douyin", works: [], trendTopics: [], interests: [] };
    const briefs = shapeAngleBriefs(empty, { limit: 5 });
    expect(briefs).toHaveLength(1);
    expect(briefs[0].grounding).toBe("thin");
    // does not invent any topic — tells the user to configure their niche
    expect(briefs[0].hook).toBe("");
    expect(briefs[0].why).toContain("趋势");
  });

  it("respects the limit and yields stable, unique ids", () => {
    const briefs = shapeAngleBriefs(richCtx, { limit: 2 });
    expect(briefs).toHaveLength(2);
    expect(new Set(briefs.map((b) => b.id)).size).toBe(2);
    expect(shapeAngleBriefs(richCtx, { limit: 0 })).toEqual([]);
  });

  it("falls back to platform-only direction when trends exist but no interest is set", () => {
    const noInterest: AngleBriefContext = { ...richCtx, interests: [] };
    const briefs = shapeAngleBriefs(noInterest, { limit: 1 });
    expect(briefs[0].grounding).toBe("trend");
    expect(briefs[0].title).toBe("手冲咖啡新手避坑");
  });
});

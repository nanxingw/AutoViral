import { describe, it, expect } from "vitest";
import { trendUrgency, sampleProvenance, type TrendItem } from "./trends";

function trend(over: Partial<TrendItem> = {}): TrendItem {
  return {
    id: "t1",
    platform: "xiaohongshu",
    title: "猫咪做饭",
    sourceUrl: "https://example.com/1",
    source: "scraper",
    scrapedAt: "2026-05-27T00:00:00Z",
    cover: { url: "", aspect: "9:16" },
    metrics: { views: 1000, likes: 50, comments: 5, shares: 2, fetchedAt: "x" },
    analysis: {
      heat: 3,
      competition: "中",
      opportunity: "蓝海",
      description: "d",
      tags: ["a"],
      contentAngles: ["x"],
      exampleHook: "POV: 你的猫是米其林大厨",
      category: "萌宠",
    },
    ...over,
  } as TrendItem;
}

// S13 — Rising/Breakout urgency badge derives ONLY from the data we actually
// have (heat + opportunity), never from fabricated platform velocity.
describe("trendUrgency (S13)", () => {
  it("flags 爆发/breakout at peak heat (5)", () => {
    const u = trendUrgency(trend({ analysis: { ...trend().analysis, heat: 5 } }));
    expect(u?.level).toBe("breakout");
  });

  it("flags 爆发/breakout for a 金矿 (high heat, low competition) at heat 4", () => {
    const u = trendUrgency(trend({ analysis: { ...trend().analysis, heat: 4, opportunity: "金矿" } }));
    expect(u?.level).toBe("breakout");
  });

  it("flags 上升/rising at heat 4 when not a 金矿", () => {
    const u = trendUrgency(trend({ analysis: { ...trend().analysis, heat: 4, opportunity: "红海" } }));
    expect(u?.level).toBe("rising");
  });

  it("returns null (no badge) for low heat", () => {
    expect(trendUrgency(trend({ analysis: { ...trend().analysis, heat: 2 } }))).toBeNull();
  });

  it("exposes a window-hours hint so the UI can say 'publish within Xh'", () => {
    const breakout = trendUrgency(trend({ analysis: { ...trend().analysis, heat: 5 } }));
    expect(breakout?.windowHours).toBe(72);
  });
});

// S13 — provenance honesty. 3 of 4 platforms are LLM-fabricated
// (agent_websearch, null metrics); xiaohongshu has covers but null metrics.
// The sample is "watchable" ONLY when there's a real source url AND it came
// from a real collector — never imply a watchable example for inferred rows.
describe("sampleProvenance (S13)", () => {
  it("marks agent_websearch as inferred, NOT real-metric, NOT watchable", () => {
    const p = sampleProvenance(trend({ source: "agent_websearch" }));
    expect(p.inferred).toBe(true);
    expect(p.hasRealMetrics).toBe(false);
    expect(p.watchable).toBe(false);
  });

  it("marks a scraped row that has metrics as real-metric and watchable", () => {
    const p = sampleProvenance(trend({ source: "scraper" }));
    expect(p.inferred).toBe(false);
    expect(p.hasRealMetrics).toBe(true);
    expect(p.watchable).toBe(true);
  });

  it("a scraped row with null metrics (小红书 covers-only) is watchable but NOT real-metric", () => {
    const p = sampleProvenance(trend({ source: "scraper", metrics: null }));
    expect(p.hasRealMetrics).toBe(false);
    expect(p.watchable).toBe(true);
  });

  it("a row without a usable sourceUrl is never watchable", () => {
    const p = sampleProvenance(trend({ source: "scraper", sourceUrl: "" }));
    expect(p.watchable).toBe(false);
  });
});

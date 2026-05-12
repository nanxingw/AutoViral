import { describe, it, expect } from "vitest";
import { TrendItemSchema, TrendsCollectionResultSchema, validateCollection } from "../schema.js";

describe("TrendItemSchema", () => {
  const validItem = {
    id: "yt_abc123",
    platform: "youtube",
    title: "Sample trending title",
    sourceUrl: "https://youtube.com/watch?v=abc123",
    source: "rss",
    scrapedAt: "2026-05-12T10:00:00.000Z",
    cover: {
      url: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      aspect: "16:9",
    },
    metrics: {
      views: 100000, likes: 5000, comments: 200, shares: null,
      fetchedAt: "2026-05-12T10:00:00.000Z",
    },
    analysis: {
      heat: 4,
      competition: "中",
      opportunity: "金矿",
      description: "A trending topic about something that matters this week.",
      tags: ["tag1", "tag2", "tag3"],
      contentAngles: ["angle1", "angle2"],
      exampleHook: "Hook one-liner",
      category: "tech",
    },
  };

  it("accepts a complete valid item", () => {
    expect(TrendItemSchema.safeParse(validItem).success).toBe(true);
  });

  it("rejects item missing required cover.url", () => {
    const bad = { ...validItem, cover: { aspect: "16:9" } };
    expect(TrendItemSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects analysis.heat out of [1,5]", () => {
    const bad = { ...validItem, analysis: { ...validItem.analysis, heat: 6 } };
    expect(TrendItemSchema.safeParse(bad).success).toBe(false);
  });

  it("allows metrics null (e.g. agent_websearch source has no real numbers)", () => {
    const r = TrendItemSchema.safeParse({ ...validItem, metrics: null });
    expect(r.success).toBe(true);
  });

  it("rejects platform outside the 4-enum", () => {
    const bad = { ...validItem, platform: "weibo" };
    expect(TrendItemSchema.safeParse(bad).success).toBe(false);
  });
});

describe("TrendsCollectionResultSchema", () => {
  it("requires at least 5 items", () => {
    const r = TrendsCollectionResultSchema.safeParse({
      platform: "youtube",
      items: [],
      collectedAt: "2026-05-12T10:00:00.000Z",
      pipelineStatus: "failed",
      errors: ["no items"],
      validation: { passed: false, issues: [] },
    });
    expect(r.success).toBe(false);
  });
});

describe("validateCollection", () => {
  it("returns issues with path string on failure", () => {
    const out = validateCollection({ platform: "youtube", items: "not-an-array" });
    expect(out.passed).toBe(false);
    expect(out.issues.length).toBeGreaterThan(0);
    expect(typeof out.issues[0].path).toBe("string");
  });
});

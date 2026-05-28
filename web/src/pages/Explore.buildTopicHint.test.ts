import { describe, it, expect } from "vitest";
import { buildTrendTopicHint } from "./Explore";
import type { TrendItem } from "@/queries/trends";

// #65 — the brief handed to the agent when creating from a trend.

function trend(over: Partial<TrendItem> = {}): TrendItem {
  return {
    id: "t1",
    platform: "xiaohongshu",
    title: "猫咪做饭",
    sourceUrl: "x",
    source: "agent_websearch",
    scrapedAt: "2026-05-27T00:00:00Z",
    cover: { url: "", aspect: "9:16" },
    metrics: { views: null, likes: null, comments: null },
    analysis: { opportunity: "蓝海", exampleHook: "POV: 你的猫是大厨", category: "萌宠" },
    ...over,
  } as TrendItem;
}

describe("buildTrendTopicHint (#65)", () => {
  it("joins title + category + exampleHook into a brief", () => {
    const hint = buildTrendTopicHint(trend());
    expect(hint).toBe("猫咪做饭\n萌宠\nPOV: 你的猫是大厨");
  });

  it("drops missing/empty analysis fields (no dangling separators)", () => {
    const hint = buildTrendTopicHint(
      trend({ analysis: undefined as unknown as TrendItem["analysis"] }),
    );
    expect(hint).toBe("猫咪做饭"); // title only, no trailing newlines
  });
});

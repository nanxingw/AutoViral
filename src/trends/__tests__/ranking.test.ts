import { describe, it, expect } from "vitest";
import { rankByInterests, interestFitScore } from "../ranking.js";
import type { TrendItem } from "../schema.js";

function item(over: Partial<TrendItem> & { id: string }): TrendItem {
  return {
    id: over.id,
    platform: "douyin",
    title: over.title ?? "title",
    sourceUrl: "https://example.com/x",
    source: "agent_websearch",
    scrapedAt: "2026-05-12T10:00:00.000Z",
    cover: { url: "", aspect: "9:16" },
    metrics: null,
    analysis: {
      heat: over.analysis?.heat ?? 3,
      competition: "中",
      opportunity: "蓝海",
      description: "a description long enough",
      tags: over.analysis?.tags ?? [],
      contentAngles: ["x", "y"],
      exampleHook: "hook",
      category: over.analysis?.category ?? "其他",
      ...(over.analysis ?? {}),
    },
  } as TrendItem;
}

describe("interestFitScore", () => {
  it("scores a category match higher than no match", () => {
    const fashion = item({ id: "a", analysis: { category: "穿搭" } as never });
    const noMatch = item({ id: "b", analysis: { category: "美食" } as never });
    expect(interestFitScore(fashion, ["穿搭"])).toBeGreaterThan(
      interestFitScore(noMatch, ["穿搭"]),
    );
  });

  it("scores tag and title matches too", () => {
    const tagged = item({ id: "a", analysis: { category: "其他", tags: ["健身", "增肌"] } as never });
    expect(interestFitScore(tagged, ["健身"])).toBeGreaterThan(0);
    const titled = item({ id: "b", title: "今天聊聊科技圈", analysis: { category: "其他" } as never });
    expect(interestFitScore(titled, ["科技"])).toBeGreaterThan(0);
  });

  it("returns 0 with no interests configured", () => {
    const x = item({ id: "a", analysis: { category: "穿搭" } as never });
    expect(interestFitScore(x, [])).toBe(0);
  });
});

describe("rankByInterests", () => {
  it("reorders so interest-matching trends rise even with lower heat", () => {
    const items = [
      item({ id: "hot-offtopic", analysis: { heat: 5, category: "美食" } as never }),
      item({ id: "warm-ontopic", analysis: { heat: 3, category: "穿搭" } as never }),
    ];
    const ranked = rankByInterests(items, ["穿搭"]);
    expect(ranked[0].id).toBe("warm-ontopic");
    expect(ranked[1].id).toBe("hot-offtopic");
  });

  it("falls back to heat order when no interests configured (stable)", () => {
    const items = [
      item({ id: "a", analysis: { heat: 2, category: "美食" } as never }),
      item({ id: "b", analysis: { heat: 5, category: "穿搭" } as never }),
    ];
    const ranked = rankByInterests(items, []);
    // No interests → rank purely by heat desc.
    expect(ranked.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("uses heat as a tiebreaker within the same fit tier", () => {
    const items = [
      item({ id: "low", analysis: { heat: 2, category: "穿搭" } as never }),
      item({ id: "high", analysis: { heat: 5, category: "穿搭" } as never }),
    ];
    const ranked = rankByInterests(items, ["穿搭"]);
    expect(ranked.map((i) => i.id)).toEqual(["high", "low"]);
  });

  it("does not mutate the input array", () => {
    const items = [
      item({ id: "a", analysis: { heat: 2, category: "美食" } as never }),
      item({ id: "b", analysis: { heat: 5, category: "穿搭" } as never }),
    ];
    const before = items.map((i) => i.id);
    rankByInterests(items, ["穿搭"]);
    expect(items.map((i) => i.id)).toEqual(before);
  });
});

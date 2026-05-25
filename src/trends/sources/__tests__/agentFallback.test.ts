import { describe, it, expect } from "vitest";
import { agentFallbackFromAgentJson } from "../agentFallback.js";

describe("agentFallbackFromAgentJson", () => {
  it("normalizes agent output into RawTrendItem[]", () => {
    const agentJson = {
      topics: [
        {
          title: "Hot topic 1",
          sourceUrl: "https://www.tiktok.com/discover/hot1",
          coverUrl: "https://www.tiktok.com/img/hot1.jpg",
        },
        {
          title: "Hot topic 2",
          sourceUrl: "https://www.tiktok.com/discover/hot2",
          coverUrl: "https://www.tiktok.com/img/hot2.jpg",
        },
      ],
    };
    const items = agentFallbackFromAgentJson("tiktok", agentJson);
    expect(items.length).toBe(2);
    expect(items[0].platform).toBe("tiktok");
    expect(items[0].source).toBe("agent_websearch");
    expect(items[0].metrics).toBeNull();
    expect(items[0].cover?.aspect).toBe("9:16");
    // id format is `${platform}_${8 hex}` (index folded into the hash input).
    expect(items[0].id).toMatch(/^tiktok_[0-9a-f]{8}$/);
  });

  it("emits unique ids even when every topic shares one sourceUrl (#41 repro)", () => {
    // The prompt tells the agent to reuse a single platform placeholder URL
    // when it can't verify real links, so all topics arrived with the same
    // sourceUrl — which collapsed every id to e.g. youtube_d1085ffa and made
    // enrichment smear one analysis across all 22 trends. The index in the
    // hash input must keep ids distinct.
    const placeholder = "https://www.youtube.com/feed/trending";
    const items = agentFallbackFromAgentJson("youtube", {
      topics: Array.from({ length: 22 }).map((_, i) => ({
        title: `不同标题 ${i}`,
        sourceUrl: placeholder,
        coverUrl: "",
      })),
    });
    const ids = items.map((x) => x.id);
    expect(new Set(ids).size).toBe(22); // all distinct, no collision
  });

  it("emits unique ids even when title AND sourceUrl both repeat", () => {
    // Pathological: identical topic objects. Index still disambiguates.
    const items = agentFallbackFromAgentJson("douyin", {
      topics: Array.from({ length: 5 }).map(() => ({
        title: "同一个标题",
        sourceUrl: "https://www.douyin.com/discover",
        coverUrl: "",
      })),
    });
    expect(new Set(items.map((x) => x.id)).size).toBe(5);
  });

  it("falls back to placehold.co URL when agent gives empty cover", () => {
    // Schema requires cover.url be a valid URL — null isn't allowed.
    // We synthesize a placehold.co URL with the title rendered in so the
    // frontend has a visual element. The <img onError> handler swaps in a
    // CSS gradient if even this URL fails (e.g. proxy block).
    const items = agentFallbackFromAgentJson("douyin", {
      topics: [
        { title: "Topic A", sourceUrl: "https://www.douyin.com/x", coverUrl: "" },
      ],
    });
    expect(items[0].cover).not.toBeNull();
    expect(items[0].cover?.url).toMatch(/^https:\/\/placehold\.co\//);
    expect(items[0].cover?.aspect).toBe("9:16");
  });
});

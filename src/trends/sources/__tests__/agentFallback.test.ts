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
    // sha1("https://www.tiktok.com/discover/hot1").slice(0,8) === "3a7d3670"
    expect(items[0].id).toBe("tiktok_3a7d3670");
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

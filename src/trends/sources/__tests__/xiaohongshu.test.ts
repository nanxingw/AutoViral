import { describe, it, expect } from "vitest";
import { xiaohongshuSourceFromDom } from "../xiaohongshu.js";

describe("xiaohongshuSourceFromDom (pure parser exposed for tests)", () => {
  it("extracts items from a mock explore feed payload", () => {
    const fakeFeed = [
      {
        id: "abc12345",
        title: "笔记标题 A",
        url: "/explore/abc12345",
        coverUrl: "https://sns-img-bd.xhscdn.com/abc12345.jpg",
        likes: 3500,
        views: null,
      },
      {
        id: "def67890",
        title: "笔记标题 B",
        url: "/explore/def67890",
        coverUrl: "https://sns-img-bd.xhscdn.com/def67890.jpg",
        likes: 12000,
        views: 87000,
      },
    ];
    const items = xiaohongshuSourceFromDom(fakeFeed);
    expect(items.length).toBe(2);
    expect(items[0].id).toBe("xhs_abc12345");
    expect(items[0].platform).toBe("xiaohongshu");
    expect(items[0].source).toBe("scraper");
    expect(items[0].sourceUrl).toBe("https://www.xiaohongshu.com/explore/abc12345");
    expect(items[0].cover?.aspect).toBe("9:16");
    expect(items[1].metrics?.likes).toBe(12000);
  });
});

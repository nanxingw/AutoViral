import { describe, it, expect } from "vitest";
import { normalizeTrendsPayload } from "../normalize.js";

const AT = "2026-05-11T00:00:00.000Z";

const legacy = {
  topics: [
    {
      title: "独居生活 × 真实放飞",
      heat: 5,
      competition: "高",
      opportunity: "红海",
      description: "独居话题近90天浏览量2亿+。",
      tags: ["独居vlog", "一个人生活"],
      contentAngles: ["打破独居精致人设"],
      exampleHook: "我终于承认了，独居就是可以这么邋遢...",
      category: "生活",
    },
    {
      title: "5分钟轻量化运动",
      heat: 4,
      competition: "中",
      opportunity: "金矿",
      description: "5分钟快充运动成为趋势。",
      tags: ["5分钟运动", "快充健身"],
      contentAngles: ["5分钟高效燃脂"],
      exampleHook: "再忙也能瘦！",
      category: "健身",
    },
  ],
};

describe("normalizeTrendsPayload (#49)", () => {
  it("maps legacy {topics} to {items} the frontend can read", () => {
    const out = normalizeTrendsPayload(legacy, "xiaohongshu", AT) as any;
    expect(Array.isArray(out.items)).toBe(true);
    expect(out.items).toHaveLength(2);
    expect(out.platform).toBe("xiaohongshu");
    expect(out.pipelineStatus).toBe("ok");
    const first = out.items[0];
    expect(first.title).toBe("独居生活 × 真实放飞");
    expect(first.source).toBe("agent_websearch");
    expect(first.metrics).toBeNull();
    expect(first.analysis.heat).toBe(5);
    expect(first.analysis.competition).toBe("高");
    expect(first.analysis.opportunity).toBe("红海");
    expect(first.analysis.category).toBe("生活");
    expect(first.analysis.tags).toEqual(["独居vlog", "一个人生活"]);
    expect(first.sourceUrl).toContain("xiaohongshu.com");
  });

  it("synthesizes unique ids even for duplicate titles (index-salted, #41 lesson)", () => {
    const dup = { topics: [{ title: "同名" }, { title: "同名" }, { title: "同名" }] };
    const out = normalizeTrendsPayload(dup, "douyin", AT) as any;
    const ids = out.items.map((i: any) => i.id);
    expect(new Set(ids).size).toBe(3); // no collisions
  });

  it("passes through an already-{items} payload untouched", () => {
    const modern = {
      platform: "youtube",
      items: [{ id: "x1", title: "already normalized" }],
      collectedAt: AT,
      pipelineStatus: "ok",
    };
    expect(normalizeTrendsPayload(modern, "youtube", AT)).toBe(modern);
  });

  it("coerces out-of-range / missing analysis fields to safe defaults", () => {
    const messy = { topics: [{ title: "x", heat: 99, competition: "???", opportunity: "??" }] };
    const out = normalizeTrendsPayload(messy, "tiktok", AT) as any;
    const a = out.items[0].analysis;
    expect(a.heat).toBe(5); // clamped into 1..5
    expect(a.competition).toBe("中"); // unknown → default
    expect(a.opportunity).toBe("蓝海"); // unknown → default
    expect(out.items[0].analysis.tags).toEqual([]); // missing → []
  });

  it("inherits the dated-file fallback timestamp when topics have none", () => {
    const out = normalizeTrendsPayload(legacy, "xiaohongshu", AT) as any;
    expect(out.collectedAt).toBe(AT);
    expect(out.items[0].scrapedAt).toBe(AT);
  });

  it("returns non-object input unchanged", () => {
    expect(normalizeTrendsPayload(null, "youtube", AT)).toBeNull();
    expect(normalizeTrendsPayload("nope", "youtube", AT)).toBe("nope");
  });
});

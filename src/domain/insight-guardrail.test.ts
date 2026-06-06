import { describe, it, expect } from "vitest";
import {
  AVAILABLE_METRICS,
  FORBIDDEN_METRIC_KEYWORDS,
  detectForbiddenMetrics,
  filterInsights,
  parseAgentInsights,
  buildInsightPrompt,
  type InsightCandidate,
} from "./insight-guardrail.js";

/**
 * D3 — the honesty enforcer. AutoViral NEVER measures retention / 完播 /
 * hook-timing; the only metrics on disk are play / digg / comment / share /
 * collect. Any agent-emitted insight that cites a metric outside that set is
 * fabrication and MUST be rejected. This is the core regression gate for
 * honesty, so it is tested hard.
 */

const ON_DISK = AVAILABLE_METRICS;

describe("AVAILABLE_METRICS — exactly the five on-disk metrics", () => {
  it("contains play / digg / comment / share / collect and NOTHING measuring retention", () => {
    expect(ON_DISK.has("play")).toBe(true);
    expect(ON_DISK.has("digg")).toBe(true);
    expect(ON_DISK.has("comment")).toBe(true);
    expect(ON_DISK.has("share")).toBe(true);
    expect(ON_DISK.has("collect")).toBe(true);
    // the never-measured ones are NOT available
    expect(ON_DISK.has("retention")).toBe(false);
    expect(ON_DISK.has("completion")).toBe(false);
    expect(ON_DISK.has("hookTiming")).toBe(false);
  });
});

describe("detectForbiddenMetrics — scans body prose for never-measured metrics", () => {
  it("flags 完播率 in Chinese prose", () => {
    const hits = detectForbiddenMetrics("暖色调与近期内容的 +18% 完播率相关。");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("flags 留存 / retention / hook timing in either language", () => {
    expect(detectForbiddenMetrics("你的留存率在前 3 秒掉了").length).toBeGreaterThan(0);
    expect(detectForbiddenMetrics("retention dropped after the hook").length).toBeGreaterThan(0);
    expect(detectForbiddenMetrics("optimise your hook timing for the first 3s").length).toBeGreaterThan(0);
    expect(detectForbiddenMetrics("watch time is up 20%").length).toBeGreaterThan(0);
  });

  it("does NOT flag honest insights that only cite play / digg / comment", () => {
    expect(detectForbiddenMetrics("你的埃及奇遇播放 2705，是点赞最高的一条")).toEqual([]);
    expect(detectForbiddenMetrics("评论互动几乎为零，可以多设置话题引导")).toEqual([]);
    expect(detectForbiddenMetrics("share and collect counts are low on your sci-fi posts")).toEqual([]);
  });

  it("exposes the forbidden keyword list for transparency", () => {
    expect(FORBIDDEN_METRIC_KEYWORDS.length).toBeGreaterThan(0);
  });
});

describe("filterInsights — the honesty gate", () => {
  it("REJECTS an insight citing 完播率 (a metric AutoViral never measures)", () => {
    const candidates: InsightCandidate[] = [
      { body: "暖色调校色与你近期内容的 +18% 完播率相关。", tag: "风格建议", metrics: ["play"] },
    ];
    const passed = filterInsights(candidates, ON_DISK);
    expect(passed).toHaveLength(0);
  });

  it("REJECTS an insight that DECLARES a forbidden metric even if its body looks clean", () => {
    const candidates: InsightCandidate[] = [
      { body: "你的某类作品表现更好。", tag: "信号", metrics: ["retention"] },
    ];
    expect(filterInsights(candidates, ON_DISK)).toHaveLength(0);
  });

  it("REJECTS retention / hook-timing insights regardless of declared metrics", () => {
    const candidates: InsightCandidate[] = [
      { body: "你的钩子留存在前 3 秒掉得很快。", tag: "钩子", metrics: ["play", "digg"] },
      { body: "watch time on your vlogs is your strongest signal.", tag: "signal", metrics: ["play"] },
    ];
    expect(filterInsights(candidates, ON_DISK)).toHaveLength(0);
  });

  it("PASSES an insight that only cites play / digg / comment", () => {
    const candidates: InsightCandidate[] = [
      {
        body: "你的埃及奇遇播放 2705，是 9 条里最高的，但点赞只有 23——曝光不缺，缺的是互动钩子。",
        tag: "互动",
        metrics: ["play", "digg"],
      },
    ];
    const passed = filterInsights(candidates, ON_DISK);
    expect(passed).toHaveLength(1);
    expect(passed[0].body).toContain("2705");
  });

  it("filters a MIXED batch — keeps the honest ones, drops the fabricated", () => {
    const candidates: InsightCandidate[] = [
      { body: "街头穿搭点赞 60，是你点赞率最高的方向。", tag: "方向", metrics: ["play", "digg"] }, // ok
      { body: "你的完播率在科幻类内容上最高。", tag: "风格", metrics: ["play"] }, // forbidden in prose
      { body: "收藏数偏低，可以做更有保存价值的干货。", tag: "收藏", metrics: ["collect"] }, // ok
      { body: "提升 hook retention 能放大播放。", tag: "钩子", metrics: ["retention"] }, // forbidden declared
    ];
    const passed = filterInsights(candidates, ON_DISK);
    expect(passed).toHaveLength(2);
    expect(passed.map((p) => p.tag)).toEqual(["方向", "收藏"]);
  });

  it("drops malformed candidates (empty body) instead of rendering them", () => {
    const candidates: InsightCandidate[] = [
      { body: "   ", tag: "空", metrics: ["play"] },
      { body: "评论为 0，建议在文案里抛一个问题。", tag: "互动", metrics: ["comment"] },
    ];
    const passed = filterInsights(candidates, ON_DISK);
    expect(passed).toHaveLength(1);
    expect(passed[0].tag).toBe("互动");
  });
});

describe("parseAgentInsights — robust JSON boundary, then guardrail", () => {
  it("parses a clean JSON array and passes only honest insights through D3", () => {
    const raw = JSON.stringify([
      { body: "埃及奇遇播放 2705 最高，互动却低，下一条可加引导评论的钩子。", tag: "互动", metrics: ["play", "comment"] },
      { body: "完播率显示你的科幻类最留人。", tag: "风格", metrics: ["play"] },
    ]);
    const out = parseAgentInsights(raw, ON_DISK);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe("互动");
  });

  it("extracts a JSON array embedded in agent chatter (markdown fences / preamble)", () => {
    const raw =
      "好的，这是基于你真实数据的洞察：\n```json\n" +
      JSON.stringify([{ body: "街头穿搭点赞 60 最高。", tag: "方向", metrics: ["digg"] }]) +
      "\n```\n希望有帮助。";
    const out = parseAgentInsights(raw, ON_DISK);
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain("60");
  });

  it("returns [] (not a throw) on unparseable garbage — never renders junk", () => {
    expect(parseAgentInsights("the model said something but no json", ON_DISK)).toEqual([]);
    expect(parseAgentInsights("", ON_DISK)).toEqual([]);
  });

  it("defaults a missing metrics array to a body-text scan (still rejects forbidden prose)", () => {
    const raw = JSON.stringify([
      { body: "你的完播率在前 3 秒掉了。", tag: "钩子" },
      { body: "播放 2705 是最高的一条。", tag: "曝光" },
    ]);
    const out = parseAgentInsights(raw, ON_DISK);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe("曝光");
  });
});

describe("buildInsightPrompt — grounds the agent on REAL metrics only", () => {
  const works = [
    { desc: "埃及奇遇 #日常volg", playCount: 2705, diggCount: 23, commentCount: 0, shareCount: 0, collectCount: 3 },
    { desc: "lights on the street #街头穿搭", playCount: 967, diggCount: 60, commentCount: 0, shareCount: 0, collectCount: 2 },
  ];

  it("embeds the real per-work metrics so the agent grounds in truth", () => {
    const p = buildInsightPrompt(works);
    expect(p).toContain("埃及奇遇");
    expect(p).toContain("2705");
    expect(p).toContain("60");
  });

  it("forbids the agent from inventing never-measured metrics", () => {
    const p = buildInsightPrompt(works);
    expect(p).toMatch(/完播|留存|retention/i); // it names them in order to forbid them
    expect(p).toMatch(/不要|禁止|never|don't|do not/i);
  });

  it("asks for a JSON array of {body, tag, metrics}", () => {
    const p = buildInsightPrompt(works);
    expect(p).toMatch(/json/i);
    expect(p).toContain("body");
    expect(p).toContain("metrics");
  });

  it("is honest about thin data (degrades, doesn't fabricate) when given no works", () => {
    const p = buildInsightPrompt([]);
    expect(p).toMatch(/没有|暂无|无作品/);
  });
});

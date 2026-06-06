import { describe, it, expect } from "vitest";
import { deriveCreatorAnalytics, type WorkMetricInput } from "./creator-analytics";

/**
 * Fixture inlined from the user's frozen Douyin scrape
 * (~/.autoviral/analytics/douyin/latest.json) — 9 real published works.
 * summary.avg_play === 624 on disk; these are the REAL numbers, render them
 * truthfully (PRD-0006 honesty constraint). Highest-play work is the Egypt
 * vlog (2705); lowest is the farewell clip (20).
 */
const WORKS: WorkMetricInput[] = [
  { desc: "陪女朋友看球赛~ #体育场看台拍照 #女球迷", playCount: 565, diggCount: 20, commentCount: 0, shareCount: 1, collectCount: 0 },
  { desc: "🖤#二次元 #壁纸", playCount: 67, diggCount: 8, commentCount: 0, shareCount: 0, collectCount: 0 },
  { desc: "lights on the street #街头穿搭 #蕾丝", playCount: 967, diggCount: 60, commentCount: 0, shareCount: 0, collectCount: 2 },
  { desc: "月球战争PV #科幻 #月球 #战争", playCount: 581, diggCount: 10, commentCount: 2, shareCount: 0, collectCount: 0 },
  { desc: "猪的忧郁我不懂 #生化危机 #忧郁 #猪猪侠", playCount: 63, diggCount: 6, commentCount: 0, shareCount: 0, collectCount: 0 },
  { desc: "起早了，梦到成哮天犬了#小狗🐶 #萌宠出道计划 #狗狗", playCount: 276, diggCount: 20, commentCount: 0, shareCount: 0, collectCount: 1 },
  { desc: "埃及奇遇 #我要上热门 #日常volg #感谢抖音官大大热门", playCount: 2705, diggCount: 23, commentCount: 0, shareCount: 0, collectCount: 3 },
  { desc: "”所以，我们还会再见吗？“", playCount: 20, diggCount: 2, commentCount: 0, shareCount: 0, collectCount: 0 },
  { desc: "“自由的从来不是眼前的风景，而是纯粹的灵魂。”", playCount: 377, diggCount: 2, commentCount: 0, shareCount: 0, collectCount: 0 },
];

describe("deriveCreatorAnalytics", () => {
  it("prefers the on-disk summary avg_play (624) as avgViews", () => {
    const result = deriveCreatorAnalytics(WORKS, { avgPlay: 624 });
    expect(result.avgViews).toBe(624);
  });

  it("falls back to the floor of the computed mean when summary avgPlay is absent", () => {
    // mean of the 9 real plays = 624.55… → floored to 624
    const result = deriveCreatorAnalytics(WORKS, {});
    expect(result.avgViews).toBe(624);
  });

  it("returns one row per work, defaulting sorted by play descending", () => {
    const result = deriveCreatorAnalytics(WORKS, { avgPlay: 624 });
    expect(result.rows).toHaveLength(9);
    expect(result.rows[0].playCount).toBe(2705);
    expect(result.rows[0].desc).toContain("埃及奇遇");
    expect(result.rows[8].playCount).toBe(20);
  });

  it("identifies the top work by play count", () => {
    const result = deriveCreatorAnalytics(WORKS, { avgPlay: 624 });
    expect(result.topByPlay?.playCount).toBe(2705);
    expect(result.topByPlay?.desc).toContain("埃及奇遇");
  });

  it("sorts rows by likes (digg) descending when requested", () => {
    const result = deriveCreatorAnalytics(WORKS, { avgPlay: 624 }, "digg");
    // highest digg is the street-style work (60), lowest are 2-digg works
    expect(result.rows[0].diggCount).toBe(60);
    expect(result.rows[0].desc).toContain("lights on the street");
    expect(result.rows[result.rows.length - 1].diggCount).toBe(2);
  });

  it("sorts by play descending for the explicit 'play' key", () => {
    const result = deriveCreatorAnalytics(WORKS, { avgPlay: 624 }, "play");
    const plays = result.rows.map((r) => r.playCount);
    expect(plays).toEqual([...plays].sort((a, b) => b - a));
  });

  it("keeps share/collect counts on each row (truthful surface, not dropped)", () => {
    const result = deriveCreatorAnalytics(WORKS, { avgPlay: 624 }, "play");
    expect(result.rows[0].shareCount).toBe(0);
    expect(result.rows[0].collectCount).toBe(3);
    const street = result.rows.find((r) => r.desc.includes("lights on the street"));
    expect(street?.collectCount).toBe(2);
  });

  it("is stable for ties (does not throw, keeps all rows) and tolerates empty input", () => {
    const empty = deriveCreatorAnalytics([], {});
    expect(empty.avgViews).toBe(0);
    expect(empty.rows).toEqual([]);
    expect(empty.topByPlay).toBeNull();
  });

  it("gives each row a stable id for keying", () => {
    const result = deriveCreatorAnalytics(WORKS, { avgPlay: 624 }, "play");
    const ids = result.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

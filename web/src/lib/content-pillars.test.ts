import { describe, it, expect } from "vitest";
import { derivePillarComparison, assignPillar, type PillarKey } from "./content-pillars";
import type { WorkMetricInput } from "./creator-analytics";

/**
 * Fixture inlined from the user's frozen Douyin scrape
 * (~/.autoviral/analytics/douyin/latest.json) — the 9 real published works.
 * S10 tags each into a deterministic content pillar (rule-based, off the
 * caption hashtags/keywords) and aggregates per-pillar performance so the 9
 * works become comparable ("你的 X 类作品互动是 Y 类的 N 倍").
 *
 * Expected deterministic assignment (verified against the rule keyword sets):
 *   - 球赛/女球迷/埃及/日常volg → lifestyle (日常)        [565, 2705]
 *   - 二次元/壁纸/科幻/月球/战争/生化危机 → anime (二次元)  [67, 581, 63]
 *   - 街头穿搭/蕾丝 → fashion (穿搭)                       [967]
 *   - 小狗/萌宠/狗狗 → pets (萌宠)                          [276]
 *   - the two bare sentimental quotes → other (其他)        [20, 377]
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

describe("assignPillar (deterministic rule-based tagging)", () => {
  it("tags by caption hashtags/keywords, deterministically", () => {
    expect(assignPillar("lights on the street #街头穿搭 #蕾丝")).toBe<PillarKey>("fashion");
    expect(assignPillar("🖤#二次元 #壁纸")).toBe<PillarKey>("anime");
    expect(assignPillar("月球战争PV #科幻 #月球 #战争")).toBe<PillarKey>("anime");
    expect(assignPillar("起早了，梦到成哮天犬了#小狗🐶 #萌宠出道计划 #狗狗")).toBe<PillarKey>("pets");
    expect(assignPillar("埃及奇遇 #我要上热门 #日常volg")).toBe<PillarKey>("lifestyle");
    expect(assignPillar("陪女朋友看球赛~ #体育场看台拍照 #女球迷")).toBe<PillarKey>("lifestyle");
  });

  it("falls back to 'other' when no keyword matches (bare sentimental quotes)", () => {
    expect(assignPillar("”所以，我们还会再见吗？“")).toBe<PillarKey>("other");
    expect(assignPillar("")).toBe<PillarKey>("other");
  });

  it("is a pure function — same input, same output", () => {
    const d = "lights on the street #街头穿搭 #蕾丝";
    expect(assignPillar(d)).toBe(assignPillar(d));
  });
});

describe("derivePillarComparison (S10 aggregation)", () => {
  it("assigns the 9 works into 3–5 pillars (PRD: 3–5 content pillars)", () => {
    const { pillars } = derivePillarComparison(WORKS);
    expect(pillars.length).toBeGreaterThanOrEqual(3);
    expect(pillars.length).toBeLessThanOrEqual(5);
  });

  it("does not lose or duplicate works — every work lands in exactly one pillar", () => {
    const { pillars } = derivePillarComparison(WORKS);
    const totalCount = pillars.reduce((sum, p) => sum + p.workCount, 0);
    expect(totalCount).toBe(WORKS.length);
  });

  it("aggregates per-pillar work count + total/avg play correctly", () => {
    const { pillars } = derivePillarComparison(WORKS);
    const byKey = Object.fromEntries(pillars.map((p) => [p.key, p]));

    // lifestyle: 565 + 2705 = 3270 over 2 works → avg 1635
    expect(byKey.lifestyle.workCount).toBe(2);
    expect(byKey.lifestyle.totalPlay).toBe(3270);
    expect(byKey.lifestyle.avgPlay).toBe(1635);

    // anime: 67 + 581 + 63 = 711 over 3 works → avg 237
    expect(byKey.anime.workCount).toBe(3);
    expect(byKey.anime.totalPlay).toBe(711);
    expect(byKey.anime.avgPlay).toBe(237);

    // fashion: single work 967
    expect(byKey.fashion.workCount).toBe(1);
    expect(byKey.fashion.avgPlay).toBe(967);
  });

  it("aggregates per-pillar engagement (digg+comment+share+collect over play)", () => {
    const { pillars } = derivePillarComparison(WORKS);
    const fashion = pillars.find((p) => p.key === "fashion")!;
    // street-style: (60 + 0 + 0 + 2) / 967 = 0.06411…
    expect(fashion.engagementRate).toBeCloseTo(62 / 967, 6);
  });

  it("sorts pillars by avg play descending (best-performing pillar first)", () => {
    const { pillars } = derivePillarComparison(WORKS);
    const avgs = pillars.map((p) => p.avgPlay);
    expect(avgs).toEqual([...avgs].sort((a, b) => b - a));
    // lifestyle (avg 1635) is the strongest pillar
    expect(pillars[0].key).toBe("lifestyle");
  });

  it("reports the top vs weakest pillar ratio so '你的 X 类是 Y 类的 N 倍' is computable", () => {
    const { topPillar, multiple } = derivePillarComparison(WORKS);
    // top is lifestyle (1635), weakest non-zero is 'other' (avg of 20 & 377 = 198 → floor 198)
    expect(topPillar?.key).toBe("lifestyle");
    // ratio is finite + > 1 when pillars differ
    expect(multiple).toBeGreaterThan(1);
  });

  it("tolerates empty input (no works → no pillars, null top, no NaN)", () => {
    const result = derivePillarComparison([]);
    expect(result.pillars).toEqual([]);
    expect(result.topPillar).toBeNull();
    expect(result.multiple).toBeNull();
  });

  it("only emits pillars that actually have works (no empty buckets)", () => {
    const oneFashion: WorkMetricInput[] = [
      { desc: "#街头穿搭", playCount: 100, diggCount: 5, commentCount: 0, shareCount: 0, collectCount: 0 },
    ];
    const { pillars } = derivePillarComparison(oneFashion);
    expect(pillars).toHaveLength(1);
    expect(pillars[0].key).toBe("fashion");
  });
});

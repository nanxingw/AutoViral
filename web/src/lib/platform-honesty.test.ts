import { describe, it, expect } from "vitest";
import {
  getPlatformHonestyMatrix,
  type PlatformHonestyRow,
} from "./platform-honesty";

/**
 * PRD-0006 S2 — the platform-honesty matrix is the load-bearing honesty
 * surface that replaces the deleted demographics cards. It must state, per
 * platform, the TRUE capability:
 *   - ownData:   can AutoViral pull this creator's own post metrics?
 *   - demographics: can it pull audience age/gender/region, and the threshold?
 *   - trendSource: is the trend feed really scraped, or LLM-inferred?
 *
 * The values are i18n keys (not literals) so the UI localizes; the shape and
 * the honesty CONTENT (which platform is real vs LLM, which demographics are
 * OAuth-only/unobtainable) is what this pure core owns and what we lock with
 * tests so a future edit can't silently re-introduce the "等待后台采集" lie.
 */
describe("getPlatformHonestyMatrix", () => {
  const matrix = getPlatformHonestyMatrix();
  const byId = (id: string): PlatformHonestyRow => {
    const row = matrix.find((r) => r.id === id);
    if (!row) throw new Error(`no row for ${id}`);
    return row;
  };

  it("covers exactly the four platforms the product talks about", () => {
    expect(matrix.map((r) => r.id).sort()).toEqual(
      ["douyin", "tiktok", "xiaohongshu", "youtube"].sort(),
    );
  });

  it("every cell carries an i18n key and a yes|partial|no verdict", () => {
    for (const row of matrix) {
      for (const cell of [row.ownData, row.demographics, row.trendSource]) {
        expect(cell.labelKey).toMatch(/^analytics\.matrix\./);
        expect(["yes", "partial", "no"]).toContain(cell.verdict);
      }
    }
  });

  it("tells the truth about douyin: own data yes (frozen scrape), demographics NO at this scale", () => {
    const douyin = byId("douyin");
    // S1 already renders the frozen douyin scrape — own data is real.
    expect(douyin.ownData.verdict).toBe("yes");
    // Demographics are OAuth-only / enterprise-account only; at 5 followers
    // no API returns them. The honest verdict is "no", NOT "等待采集".
    expect(douyin.demographics.verdict).toBe("no");
  });

  it("tells the truth about which trend feeds are real-scrape vs LLM-inferred", () => {
    // Only 小红书 + 抖音 have a real collector path; YouTube/TikTok trends are
    // LLM-inferred (see Explore live-dot history). The verdict must reflect
    // that asymmetry so the matrix never pretends LLM output is real metrics.
    expect(byId("douyin").trendSource.verdict).toBe("yes");
    expect(byId("xiaohongshu").trendSource.verdict).toBe("yes");
    expect(byId("youtube").trendSource.verdict).toBe("partial");
    expect(byId("tiktok").trendSource.verdict).toBe("partial");
  });

  it("never claims any platform can hand back audience demographics at this scale", () => {
    // The whole point of S2: demographics is unobtainable everywhere here.
    for (const row of matrix) {
      expect(row.demographics.verdict).toBe("no");
    }
  });
});

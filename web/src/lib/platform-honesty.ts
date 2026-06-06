import type { MessageKey } from "@/i18n/useT";

/**
 * PRD-0006 S2 — the platform-honesty matrix.
 *
 * This is the deep, testable core behind the new 平台诚实矩阵 card. It encodes,
 * per platform, the TRUE answer to three questions a creator actually has:
 *
 *   1. ownData      — can AutoViral pull *your own* post metrics?
 *   2. demographics — can it pull *audience* age / gender / region, and at
 *                     what threshold? (Answer everywhere at this scale: no —
 *                     demographics are owner-OAuth-only / enterprise-account
 *                     only, and a 5-follower account gets nothing back from
 *                     any platform API. We deleted the cards rather than lie.)
 *   3. trendSource  — is the trend feed really scraped, or LLM-inferred?
 *
 * Cells hold i18n KEYS (not literals) so the table localizes, plus a coarse
 * `verdict` (yes | partial | no) that drives the dot colour AND is what the
 * unit tests lock — so a future edit can't silently re-introduce the
 * "等待后台采集" lie or pretend LLM output is real platform metrics.
 *
 * Keep this a pure data function: no I/O, no React. The UI shell only renders.
 */
export type HonestyVerdict = "yes" | "partial" | "no";

export interface HonestyCell {
  verdict: HonestyVerdict;
  labelKey: MessageKey;
}

export interface PlatformHonestyRow {
  id: "douyin" | "xiaohongshu" | "youtube" | "tiktok";
  /** i18n key for the platform display name. */
  nameKey: MessageKey;
  ownData: HonestyCell;
  demographics: HonestyCell;
  trendSource: HonestyCell;
}

/**
 * Demographics is unobtainable for every platform at this scale, so every row
 * shares the same honest demographics cell. Centralising it keeps the
 * "never claim demographics" invariant in one place (and the test asserts it).
 */
const DEMOGRAPHICS_UNAVAILABLE: HonestyCell = {
  verdict: "no",
  labelKey: "analytics.matrix.demoNone",
};

export function getPlatformHonestyMatrix(): PlatformHonestyRow[] {
  return [
    {
      id: "douyin",
      nameKey: "analytics.matrix.platformDouyin",
      // S1 already renders the frozen douyin scrape — own post metrics are real.
      ownData: { verdict: "yes", labelKey: "analytics.matrix.ownYesScrape" },
      demographics: DEMOGRAPHICS_UNAVAILABLE,
      // 抖音 has a real f2-based collector path (rebuilt in S4/S5).
      trendSource: { verdict: "yes", labelKey: "analytics.matrix.trendScraped" },
    },
    {
      id: "xiaohongshu",
      nameKey: "analytics.matrix.platformXiaohongshu",
      // No personal API; own-data is not pulled — be honest, not "soon".
      ownData: { verdict: "no", labelKey: "analytics.matrix.ownNoApi" },
      demographics: DEMOGRAPHICS_UNAVAILABLE,
      // 小红书 trends are really collected (covers/titles), so the feed is real.
      trendSource: { verdict: "yes", labelKey: "analytics.matrix.trendScraped" },
    },
    {
      id: "youtube",
      nameKey: "analytics.matrix.platformYoutube",
      // Own analytics would need connect-channel OAuth — explicitly out of
      // scope this version, so own-data is not available today.
      ownData: { verdict: "no", labelKey: "analytics.matrix.ownOauthScope" },
      demographics: DEMOGRAPHICS_UNAVAILABLE,
      // YouTube trend rows are LLM-inferred, not scraped metrics — label it.
      trendSource: { verdict: "partial", labelKey: "analytics.matrix.trendLlm" },
    },
    {
      id: "tiktok",
      nameKey: "analytics.matrix.platformTiktok",
      ownData: { verdict: "no", labelKey: "analytics.matrix.ownOauthScope" },
      demographics: DEMOGRAPHICS_UNAVAILABLE,
      // TikTok trend rows are LLM-inferred, not scraped metrics — label it.
      trendSource: { verdict: "partial", labelKey: "analytics.matrix.trendLlm" },
    },
  ];
}

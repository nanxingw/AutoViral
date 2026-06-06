/**
 * D2 — benchmark positioning pure core (PRD-0006 S3).
 *
 * Turns an isolated KPI into a *diagnostic statement* by placing it inside a
 * same-tier creator baseline band: "互动率 2.6% → 低于 nano 层中位数，目标区间
 * 6%–12%". Pure + UI-agnostic so it is unit-testable in isolation
 * (see `benchmark.test.ts`); the UI is a thin rendering shell.
 *
 * HONESTY constraint (the load-bearing rule of this slice): the user's real
 * platform is Douyin, so the Douyin engagement band is the only one we treat
 * as *platform-correct* (`referenceOnly: false`) — we have a defensible public
 * range for it. Every other platform's band, and any metric for which we have
 * no trustworthy Douyin-equivalent baseline (absolute play/like/comment
 * counts are too content-dependent to benchmark per tier), is returned either
 * as `referenceOnly: true` (UI labels it 「参考性、非你所在平台」) or with no band
 * at all. We NEVER silently compare a number against a borrowed band as if it
 * were the user's platform — that would be a pseudo-diagnostic and break the
 * honesty theme.
 *
 * The pure core returns i18n message *keys + params*, not localised strings,
 * so the diagnostic / reassurance copy stays bilingual via `t()` (matches the
 * codebase i18n pattern; see useT.ts).
 */
import DATA from "./benchmark-data.json";

export type Platform = "douyin" | "xiaohongshu" | "tiktok" | "youtube";

/** Follower tiers — nano <1k, micro 1k–10k, mid 10k–100k, macro 100k+. */
export type FollowerTier = "nano" | "micro" | "mid" | "macro";

/**
 * Metrics the benchmark can position. Only `engagement` (rate) has a
 * trustworthy per-tier baseline; absolute counts are intentionally
 * un-benchmarked (see honesty note above).
 */
export type BenchmarkMetric =
  | "engagement"
  | "playCount"
  | "diggCount"
  | "commentCount";

export type BandPosition = "below" | "within" | "above" | "unavailable";

export interface BenchmarkResult {
  platform: Platform;
  tier: FollowerTier;
  metric: BenchmarkMetric;
  /** The value being positioned (echoed for the UI). */
  value: number;
  /** Where the value sits relative to the same-tier band. */
  band: BandPosition;
  /** Band edges (0 when `band === "unavailable"`). */
  low: number;
  median: number;
  high: number;
  /**
   * `false` ONLY for a platform-correct band (the user's real platform with a
   * trustworthy baseline). `true` means "参考性、非你所在平台" — shown but never
   * treated as an apples-to-apples judgement of the user's platform.
   */
  referenceOnly: boolean;
  /** Provenance of the baseline; non-empty whenever a real band exists. */
  source: string | null;
  /** i18n key for the diagnostic sentence. */
  diagnosticKey: string;
  /** Interpolation params (percentages pre-formatted) for the diagnostic. */
  diagnosticParams: Record<string, string | number>;
  /** i18n key for the reassurance line, or null when none applies. */
  reassuranceKey: string | null;
}

type Band = { low: number; median: number; high: number };
type PlatformEntry = {
  referenceOnly: boolean;
  source: string;
  tiers: Record<string, Band>;
};
type MetricTable = Record<string, PlatformEntry>;

const TABLE: Record<string, MetricTable> = DATA as unknown as Record<
  string,
  MetricTable
>;

/** Map a raw follower count to a tier. */
export function followerTier(followers: number): FollowerTier {
  if (followers < 1_000) return "nano";
  if (followers < 10_000) return "micro";
  if (followers < 100_000) return "mid";
  return "macro";
}

/** Render a fraction (0.026) as a percent string ("2.6%") for copy params. */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function classify(value: number, band: Band): BandPosition {
  if (value < band.low) return "below";
  if (value > band.high) return "above";
  return "within";
}

/**
 * Position `value` of `metric` inside the same-tier creator baseline.
 *
 * @param platform the creator's platform (drives platform-correctness)
 * @param tier     follower tier (see {@link followerTier})
 * @param metric   which KPI is being positioned
 * @param value    the raw KPI value (engagement as a fraction, counts as ints)
 */
export function positionInBand(
  platform: Platform,
  tier: FollowerTier,
  metric: BenchmarkMetric,
  value: number,
): BenchmarkResult {
  const metricTable = TABLE[metric];
  const entry = metricTable?.[platform];
  const band = entry?.tiers?.[tier];

  // No band at all → honest "no baseline" result, flagged reference-only so no
  // caller ever treats the absence as a pass/fail on the user's platform.
  if (!entry || !band) {
    return {
      platform,
      tier,
      metric,
      value,
      band: "unavailable",
      low: 0,
      median: 0,
      high: 0,
      referenceOnly: true,
      source: null,
      diagnosticKey: "analytics.benchmark.noBand",
      diagnosticParams: {},
      reassuranceKey: null,
    };
  }

  const position = classify(value, band);
  // referenceOnly comes straight from the data — a borrowed (non-Douyin) band
  // or a content-dependent metric is true; only the platform-correct Douyin
  // engagement band is false. The flag and the source can never disagree.
  const referenceOnly = entry.referenceOnly;

  const diagnosticParams: Record<string, string | number> = {
    value: pct(value),
    low: pct(band.low),
    median: pct(band.median),
    high: pct(band.high),
  };

  const diagnosticKey =
    position === "below"
      ? "analytics.benchmark.diagBelow"
      : position === "above"
        ? "analytics.benchmark.diagAbove"
        : "analytics.benchmark.diagWithin";

  // Reassurance: only when a small account (nano/micro) lands below band —
  // small audiences engage harder, so a below-band read there is expected and
  // shouldn't discourage. Don't nag a healthy/within/above number, and don't
  // tell a macro account it's "small".
  const reassuranceKey =
    position === "below" && (tier === "nano" || tier === "micro")
      ? "analytics.benchmark.reassureSmallAccount"
      : null;

  return {
    platform,
    tier,
    metric,
    value,
    band: position,
    low: band.low,
    median: band.median,
    high: band.high,
    referenceOnly,
    source: entry.source,
    diagnosticKey,
    diagnosticParams,
    reassuranceKey,
  };
}

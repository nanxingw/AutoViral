import { useT, type MessageKey } from "@/i18n/useT";
import type { BenchmarkResult, FollowerTier } from "@/lib/benchmark";
import styles from "./BenchmarkBand.module.css";

/**
 * PRD-0006 S3 — the D2 benchmark band, rendered next to a KPI so an isolated
 * number ("互动率 2.6%") reads as a diagnostic statement ("低于 nano 层中位数，
 * 目标区间 6%–12%"). The positioning logic + honesty flags are owned by the
 * pure core `positionInBand` (see benchmark.ts); this is the rendering shell.
 *
 * Honesty surface: when `result.referenceOnly` is true the band is explicitly
 * labelled 「参考性、非你所在平台」 so it is never mistaken for a same-platform
 * judgement. When there is no trustworthy baseline at all (`band ===
 * "unavailable"`) we render nothing rather than fake a band.
 */

const TIER_KEY: Record<FollowerTier, MessageKey> = {
  nano: "analytics.benchmark.tierNano",
  micro: "analytics.benchmark.tierMicro",
  mid: "analytics.benchmark.tierMid",
  macro: "analytics.benchmark.tierMacro",
};

const PLATFORM_KEY: Record<string, MessageKey> = {
  douyin: "analytics.matrix.platformDouyin",
  xiaohongshu: "analytics.matrix.platformXiaohongshu",
  youtube: "analytics.matrix.platformYoutube",
  tiktok: "analytics.matrix.platformTiktok",
};

interface Props {
  result: BenchmarkResult;
  /** Localized label of the KPI this band annotates (for the aria-label). */
  metricLabel: string;
}

/** Clamp the value's marker position onto a 0–1 rail centred on the band. */
function markerFraction(value: number, low: number, high: number): number {
  // Pad the rail to ~1.5× the band width either side so a below/above value
  // still lands on-rail rather than at the very edge.
  const width = high - low || 1;
  const railLow = low - width * 0.75;
  const railHigh = high + width * 0.75;
  const span = railHigh - railLow || 1;
  return Math.min(1, Math.max(0, (value - railLow) / span));
}

export function BenchmarkBand({ result, metricLabel }: Props) {
  const t = useT();

  // Honest absence: no trustworthy baseline → render nothing, never a fake band.
  if (result.band === "unavailable") return null;

  const tierLabel = t(TIER_KEY[result.tier]);
  const diagnostic = t(result.diagnosticKey as MessageKey, {
    ...result.diagnosticParams,
    tier: tierLabel,
  });
  const reassurance = result.reassuranceKey
    ? t(result.reassuranceKey as MessageKey)
    : null;

  // Band span on the rail (as % positions) so the highlighted region matches
  // the same low/median/high the diagnostic copy quotes.
  const lowPos = markerFraction(result.low, result.low, result.high) * 100;
  const highPos = markerFraction(result.high, result.low, result.high) * 100;
  const valuePos = markerFraction(result.value, result.low, result.high) * 100;

  return (
    <div
      className={styles.band}
      data-band={result.band}
      data-reference-only={result.referenceOnly ? "true" : "false"}
      aria-label={t("analytics.benchmark.ariaLabel", { metric: metricLabel })}
    >
      <div className={styles.rail} aria-hidden="true">
        <span
          className={styles.range}
          style={{ left: `${lowPos}%`, right: `${100 - highPos}%` }}
        />
        <span className={styles.marker} style={{ left: `${valuePos}%` }} />
      </div>
      <p className={styles.diagnostic}>{diagnostic}</p>
      {reassurance ? <p className={styles.reassure}>{reassurance}</p> : null}
      {result.referenceOnly ? (
        <p className={styles.reference}>
          {t("analytics.benchmark.referenceNote", {
            platform: t(PLATFORM_KEY[result.platform] ?? "analytics.matrix.platformDouyin"),
          })}
        </p>
      ) : null}
    </div>
  );
}

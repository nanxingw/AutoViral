import {
  type TrendItem,
  type Platform,
  trendUrgency,
  sampleProvenance,
  useTrendReport,
} from "@/queries/trends";
import { compactNumber } from "@/lib/format";
import { useT } from "@/i18n/useT";
import styles from "./TrendDrilldown.module.css";

// S13 — trend drill-down. Opens beneath a clicked TrendingPanel row and shows:
//  • a Rising/Breakout urgency badge with a "publish within Xh" window
//  • a trendline (the real heat + on-disk metrics — honestly omitted when null)
//  • a watchable example link ONLY when the source actually provides one
//  • related angles (the agent's contentAngles + tags)
//  • the already-built report.md research report (zero UI callers before S13)
// Provenance is labeled honestly: agent_websearch rows are LLM inference (no
// real platform metrics, no watchable example); 小红书 has covers but null
// metrics. We never imply real numbers where there are none.
export function TrendDrilldown({
  platform,
  item,
  onClose,
}: {
  platform: Platform;
  item: TrendItem;
  onClose: () => void;
}) {
  const t = useT();
  const urgency = trendUrgency(item);
  const prov = sampleProvenance(item);
  const report = useTrendReport(platform, true);

  const heat = item.analysis?.heat ?? 0;
  const angles = item.analysis?.contentAngles ?? [];
  const tags = item.analysis?.tags ?? [];

  return (
    <div className={styles.drill} role="region" aria-label={t("explore.drilldown.label")}>
      <div className={styles.topRow}>
        <span className={styles.provenance} data-testid="trend-provenance" data-inferred={prov.inferred}>
          {prov.inferred ? t("explore.drilldown.provInferred") : t("explore.drilldown.provReal")}
        </span>
        {urgency && (
          <span
            className={styles.urgency}
            data-testid="trend-urgency"
            data-level={urgency.level}
          >
            {urgency.level === "breakout"
              ? t("explore.drilldown.urgencyBreakout")
              : t("explore.drilldown.urgencyRising")}
            <span className={styles.window}>
              {t("explore.drilldown.publishWindow", { hours: urgency.windowHours })}
            </span>
          </span>
        )}
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label={t("explore.drilldown.close")}
        >
          ✕
        </button>
      </div>

      {/* Trendline — the only honest velocity signal we have is agent heat.
          On-disk metrics shown when present; an explicit honesty note stands
          in for them when the row has none (covers-only / inferred). */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>{t("explore.drilldown.trendline")}</div>
        <div className={styles.heatLine} aria-label={t("explore.drilldown.heatAria", { heat })}>
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={styles.heatBar}
              data-on={i < heat}
              style={{ height: 8 + i * 5 }}
            />
          ))}
          <span className={styles.heatVal}>{t("explore.drilldown.heatVal", { heat })}</span>
        </div>
        {prov.hasRealMetrics ? (
          <div className={styles.metrics}>
            {item.metrics?.views != null && <span>▶ {compactNumber(item.metrics.views)}</span>}
            {item.metrics?.likes != null && <span>♥ {compactNumber(item.metrics.likes)}</span>}
            {item.metrics?.comments != null && <span>💬 {compactNumber(item.metrics.comments)}</span>}
          </div>
        ) : (
          <div className={styles.noMetrics} data-testid="trend-no-metrics">
            {prov.inferred
              ? t("explore.drilldown.noMetricsInferred")
              : t("explore.drilldown.noMetricsCovers")}
          </div>
        )}
      </div>

      {/* Watchable example — present only when the source actually links to a
          real, viewable post. Inferred rows never get this affordance. */}
      {prov.watchable && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>{t("explore.drilldown.example")}</div>
          <a
            className={styles.watchLink}
            data-testid="trend-watch-link"
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            ▷ {t("explore.drilldown.watchCta")}
          </a>
        </div>
      )}

      {/* Related angles — the agent's contentAngles + recommended tags. */}
      {(angles.length > 0 || tags.length > 0) && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>{t("explore.drilldown.angles")}</div>
          {angles.length > 0 && (
            <ul className={styles.angleList}>
              {angles.map((a, i) => (
                <li key={i} className={styles.angle}>{a}</li>
              ))}
            </ul>
          )}
          {tags.length > 0 && (
            <div className={styles.tags}>
              {tags.map((tag, i) => (
                <span key={i} className={styles.tag}>#{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* report.md — the agent-written research report, surfaced on demand. */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>{t("explore.drilldown.report")}</div>
        {report.isLoading ? (
          <div className={styles.reportMeta}>{t("explore.drilldown.reportLoading")}</div>
        ) : report.data ? (
          <pre className={styles.report} data-testid="trend-report">{report.data}</pre>
        ) : (
          <div className={styles.reportMeta}>{t("explore.drilldown.reportEmpty")}</div>
        )}
      </div>
    </div>
  );
}

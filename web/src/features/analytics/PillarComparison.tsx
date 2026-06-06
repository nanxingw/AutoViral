import { useMemo } from "react";
import { compactNumber } from "@/lib/format";
import { useT, type MessageKey } from "@/i18n/useT";
import {
  derivePillarComparison,
  type PillarKey,
} from "@/lib/content-pillars";
import type { WorkMetricInput } from "@/lib/creator-analytics";
import styles from "./PillarComparison.module.css";

/**
 * PRD-0006 S10 — content-pillar comparison view. The D1 extension
 * (`derivePillarComparison`) owns the deterministic tagging + per-pillar
 * aggregation; this is the thin rendering shell. The numbers are the user's
 * real on-disk per-work metrics, grouped — never fabricated.
 *
 * A method note tells the truth about the tagging being auto-derived from
 * captions (directional, not exact), matching the honesty theme.
 */
interface Props {
  works: WorkMetricInput[];
}

function pillarNameKey(key: PillarKey): MessageKey {
  return `analytics.pillars.name.${key}` as MessageKey;
}

export function PillarComparison({ works }: Props) {
  const t = useT();
  const { pillars, topPillar, multiple } = useMemo(
    () => derivePillarComparison(works),
    [works],
  );

  // Need at least two pillars to *compare* — a single bucket isn't a comparison.
  if (pillars.length < 2) return null;

  // The strongest bar drives the relative width of every bar so the visual
  // ranking reads at a glance (purely presentational; data is the avgPlay).
  const maxAvg = pillars.reduce((m, p) => Math.max(m, p.avgPlay), 0);

  return (
    <section className={styles.card} aria-label={t("analytics.pillars.ariaLabel")}>
      <div className={styles.head}>
        <h2 className={styles.h2}>
          {t("analytics.pillars.title")}{" "}
          <em>{t("analytics.pillars.titleEm")}</em>
        </h2>
        <span className={styles.count}>{t("analytics.pillars.methodNote")}</span>
      </div>
      <p className={styles.sub}>{t("analytics.pillars.sub")}</p>

      {topPillar && multiple !== null && multiple > 1 ? (
        <p className={styles.lead}>
          <em className={styles.leadEm}>
            {t("analytics.pillars.leadEm", { multiple: multiple.toFixed(1) })}
          </em>{" "}
          {t("analytics.pillars.leadBody", {
            multiple: multiple.toFixed(1),
            top: t(pillarNameKey(topPillar.key)),
            bottom: t(pillarNameKey(pillars[pillars.length - 1].key)),
          })}
        </p>
      ) : null}

      <ul className={styles.list}>
        {pillars.map((p) => {
          const widthPct = maxAvg > 0 ? Math.max(4, (p.avgPlay / maxAvg) * 100) : 4;
          return (
            <li className={styles.row} key={p.key}>
              <div className={styles.rowHead}>
                <span className={styles.name}>{t(pillarNameKey(p.key))}</span>
                <span className={styles.works}>
                  {t("analytics.pillars.worksUnit", { count: p.workCount })}
                </span>
              </div>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{ width: `${widthPct}%` }}
                  aria-hidden="true"
                />
                <span className={styles.barVal}>
                  {compactNumber(p.avgPlay)}
                </span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLbl}>
                  {t("analytics.pillars.colEngagement")}
                </span>
                <span className={styles.metaVal}>
                  {(p.engagementRate * 100).toFixed(1)}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

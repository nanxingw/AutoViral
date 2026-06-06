import { useMemo, useState } from "react";
import { compactNumber } from "@/lib/format";
import { useT } from "@/i18n/useT";
import {
  deriveCreatorAnalytics,
  type SortKey,
  type WorkMetricInput,
} from "@/lib/creator-analytics";
import styles from "./WorkPerformanceTable.module.css";

/**
 * PRD-0006 S1 — renders the user's real per-work performance (play / digg /
 * comment / share / collect) as a sortable table. The numbers are the frozen
 * Douyin scrape already on disk; the D1 pure core (`deriveCreatorAnalytics`)
 * owns the sort + avgViews logic, this is just the rendering shell.
 *
 * Sortable by play or likes (the two AC columns); click a header to re-sort
 * descending. No fabricated metrics — share/collect come straight off disk.
 */
interface Props {
  works: WorkMetricInput[];
}

export function WorkPerformanceTable({ works }: Props) {
  const t = useT();
  const [sortKey, setSortKey] = useState<SortKey>("play");

  const { rows } = useMemo(
    () => deriveCreatorAnalytics(works, {}, sortKey),
    [works, sortKey],
  );

  if (rows.length === 0) return null;

  const sortLabel = (key: SortKey, label: string) => {
    const active = sortKey === key;
    return (
      <button
        type="button"
        className={`${styles.sortBtn} ${active ? styles.sortBtnActive : ""}`}
        onClick={() => setSortKey(key)}
        aria-label={t("analytics.worksSortBy", { metric: label })}
        aria-pressed={active}
      >
        {label}
        {active ? <span className={styles.arrow}>↓</span> : null}
      </button>
    );
  };

  return (
    <section className={styles.card} aria-label={t("analytics.worksTableTitle")}>
      <div className={styles.head}>
        <h2 className={styles.h2}>
          {t("analytics.worksTableTitle")}{" "}
          <em>{t("analytics.worksTableTitleEm")}</em>
        </h2>
        <span className={styles.count}>
          {rows.length} {t("analytics.publishedWorksSuffix")}
        </span>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th aria-hidden="true" />
            <th className={styles.descCol}>{t("analytics.worksColWork")}</th>
            <th>{sortLabel("play", t("analytics.worksColPlay"))}</th>
            <th>{sortLabel("digg", t("analytics.worksColLikes"))}</th>
            <th>{t("analytics.worksColComments")}</th>
            <th>{t("analytics.worksColShares")}</th>
            <th>{t("analytics.worksColCollects")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.id}>
              <td className={styles.rank}>{idx + 1}</td>
              <td className={styles.desc} title={r.desc}>
                {r.desc || t("analytics.worksNoDesc")}
              </td>
              <td>{compactNumber(r.playCount)}</td>
              <td>{compactNumber(r.diggCount)}</td>
              <td>{compactNumber(r.commentCount)}</td>
              <td>{compactNumber(r.shareCount)}</td>
              <td>{compactNumber(r.collectCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

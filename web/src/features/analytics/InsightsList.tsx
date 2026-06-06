import { useT } from "@/i18n/useT";
import styles from "./InsightsList.module.css";

interface Item { date: string; body: string; tag: string }

/**
 * Latest-research insights. PRD-0006 S2 removed the dishonest empty branch
 * (it lied with "等待后台采集"); the honest empty case is now owned by the
 * page-level HonestEmptyState, so this component only ever renders real rows.
 * Renders null when there's nothing real to show.
 */
export function InsightsList({ items }: { items: Item[] }) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <section className={styles.card}>
      <h2 className={styles.h2}>{t("analytics.insightsTitle")} <em>{t("analytics.insightsTitleEm")}</em></h2>
      <div className={styles.sub}>{t("analytics.insightsSub")}</div>
      {items.map((i, idx) => (
        <div key={idx} className={styles.row}>
          <div className={styles.date}>{i.date}</div>
          <div className={styles.body}><p>{i.body}</p></div>
          <span className={styles.tag}>→ {i.tag}</span>
        </div>
      ))}
    </section>
  );
}

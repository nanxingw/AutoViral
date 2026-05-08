import { useT } from "@/i18n/useT";
import styles from "./InsightsList.module.css";

interface Item { date: string; body: string; tag: string }

export function InsightsList({ items }: { items: Item[] }) {
  const t = useT();
  return (
    <section className={styles.card}>
      <h2 className={styles.h2}>{t("analytics.insightsTitle")} <em>{t("analytics.insightsTitleEm")}</em></h2>
      <div className={styles.sub}>{t("analytics.insightsSub")}</div>
      {items.length === 0 ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-dimmer)",
            padding: "20px 0 4px",
            lineHeight: 1.6,
          }}
        >
          {t("analytics.insightsEmpty")}
        </div>
      ) : (
        items.map((i, idx) => (
          <div key={idx} className={styles.row}>
            <div className={styles.date}>{i.date}</div>
            <div className={styles.body}><p>{i.body}</p></div>
            <span className={styles.tag}>→ {i.tag}</span>
          </div>
        ))
      )}
    </section>
  );
}

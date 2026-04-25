import styles from "./InsightRibbon.module.css";

export interface Insight {
  tag: string;
  body: string;
  date: string;
  cta?: string;
}

export function InsightRibbon({ insights }: { insights: Insight[] }) {
  return (
    <section className={styles.wrap}>
      {insights.map((i, idx) => (
        <div key={idx} className={styles.card}>
          <span className={styles.tag}>→ {i.tag}</span>
          <h3 className={styles.head}>{i.body}</h3>
          <div className={styles.foot}>
            <span>{i.date}</span>
            {i.cta && <span style={{ color: "var(--accent)" }}>{i.cta}</span>}
          </div>
        </div>
      ))}
    </section>
  );
}

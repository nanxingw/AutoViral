import styles from "./InsightsList.module.css";

interface Item { date: string; body: string; tag: string }

export function InsightsList({ items }: { items: Item[] }) {
  return (
    <section className={styles.card}>
      <h2 className={styles.h2}>Latest research <em>insights</em></h2>
      <div className={styles.sub}>Curated by Sonnet · ranked by relevance to your channel</div>
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

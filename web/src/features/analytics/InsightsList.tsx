import styles from "./InsightsList.module.css";

interface Item { date: string; body: string; tag: string }

export function InsightsList({ items }: { items: Item[] }) {
  return (
    <section className={styles.card}>
      <h2 className={styles.h2}>Latest research <em>insights</em></h2>
      <div className={styles.sub}>Curated by Sonnet · ranked by relevance to your channel</div>
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
          暂无 research insights — Sonnet 还没分析过你最近的作品。
          完成 1 个发布作品后会自动出现首批洞察。
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

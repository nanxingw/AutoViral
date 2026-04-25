import styles from "./AnglesCard.module.css";

export interface Angle { num: string; body: string; score: string }

export function AnglesCard({ angles, onRegenerate }: { angles: Angle[]; onRegenerate: () => void }) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h2 className={styles.h2}>
          Three <em>angles</em> AutoViral thinks you should chase
        </h2>
        <button type="button" onClick={onRegenerate} className={styles.regen}>↻ REGENERATE</button>
      </div>
      <div className={styles.list}>
        {angles.map((a, i) => (
          <div key={i} className={styles.angle}>
            <div className={styles.num}>{a.num}</div>
            <div className={styles.body}>{a.body}</div>
            <div className={styles.foot}>
              <span className={styles.score}>{a.score}</span>
              <span className={styles.go}>Generate →</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

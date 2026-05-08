import styles from "./AnglesCard.module.css";

export interface Angle { num: string; body: string; score: string }

interface Props {
  angles: Angle[];
  /** Inline note shown next to the title — typically marks placeholder/static
   *  data so users don't think the cards reflect real algorithmic output. */
  note?: string;
  /** When provided, a "↻ REGENERATE" button is rendered. Omit to drop the
   *  control entirely (rather than render a no-op button). */
  onRegenerate?: () => void;
}

export function AnglesCard({ angles, note, onRegenerate }: Props) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h2 className={styles.h2}>
          Three <em>angles</em> AutoViral thinks you should chase
        </h2>
        {onRegenerate ? (
          <button type="button" onClick={onRegenerate} className={styles.regen}>↻ REGENERATE</button>
        ) : null}
      </div>
      {note ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            color: "var(--text-dimmer)",
            marginBottom: 14,
          }}
        >
          * {note}
        </div>
      ) : null}
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

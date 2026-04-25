import styles from "./DemographicsRow.module.css";

interface Props {
  age: Record<string, number>;
  gender: { male: number; female: number };
  regions: { name: string; pct: number }[];
}

export function DemographicsRow({ age, gender, regions }: Props) {
  return (
    <section className={styles.row}>
      <div className={styles.panel}>
        <h3 className={styles.h3}>Age <em>distribution</em></h3>
        <div className={styles.bars}>
          {Object.entries(age).map(([range, ratio]) => (
            <div key={range} className={styles.barRow}>
              <div className={styles.lbl}>{range}</div>
              <div className={styles.track}><div className={styles.fill} style={{ width: `${ratio * 100}%` }} /></div>
              <div className={styles.pct}>{Math.round(ratio * 100)}%</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.panel}>
        <h3 className={styles.h3}>Gender <em>split</em></h3>
        <div className={styles.legend}>
          <div className={styles.legendRow}><div className={styles.swatch} style={{ background: "var(--accent)" }} />Male · {Math.round(gender.male * 100)}%</div>
          <div className={styles.legendRow}><div className={styles.swatch} style={{ background: "var(--surface-2)", border: "1px solid var(--glass-hi)" }} />Female · {Math.round(gender.female * 100)}%</div>
        </div>
      </div>

      <div className={styles.panel}>
        <h3 className={styles.h3}>Top <em>regions</em></h3>
        {regions.map((r) => (
          <div key={r.name} className={styles.barRow}>
            <div className={styles.lbl}>{r.name}</div>
            <div className={styles.track}><div className={styles.fill} style={{ width: `${r.pct * 100}%` }} /></div>
            <div className={styles.pct}>{Math.round(r.pct * 100)}%</div>
          </div>
        ))}
      </div>
    </section>
  );
}

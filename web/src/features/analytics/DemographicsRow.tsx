import styles from "./DemographicsRow.module.css";

interface Props {
  age: Record<string, number>;
  gender: { male: number; female: number };
  regions: { name: string; pct: number }[];
}

const emptyHint: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--text-dimmer)",
  letterSpacing: "0.02em",
  padding: "12px 0 4px",
  lineHeight: 1.5,
};

export function DemographicsRow({ age, gender, regions }: Props) {
  const ageEntries = Object.entries(age);
  const ageEmpty = ageEntries.length === 0;
  const genderEmpty = gender.male === 0 && gender.female === 0;
  const regionsEmpty = regions.length === 0;
  return (
    <section className={styles.row}>
      <div className={styles.panel}>
        <h3 className={styles.h3}>Age <em>distribution</em></h3>
        {ageEmpty ? (
          <div style={emptyHint}>暂无年龄分布数据 — 等待后台采集首批样本</div>
        ) : (
          <div className={styles.bars}>
            {ageEntries.map(([range, ratio]) => (
              <div key={range} className={styles.barRow}>
                <div className={styles.lbl}>{range}</div>
                <div className={styles.track}><div className={styles.fill} style={{ width: `${ratio * 100}%` }} /></div>
                <div className={styles.pct}>{Math.round(ratio * 100)}%</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.panel}>
        <h3 className={styles.h3}>Gender <em>split</em></h3>
        {genderEmpty ? (
          <div style={emptyHint}>暂无性别分布数据 — 等待后台采集首批样本</div>
        ) : (
          <div className={styles.legend}>
            <div className={styles.legendRow}><div className={styles.swatch} style={{ background: "var(--accent)" }} />Male · {Math.round(gender.male * 100)}%</div>
            <div className={styles.legendRow}><div className={styles.swatch} style={{ background: "var(--surface-2)", border: "1px solid var(--glass-hi)" }} />Female · {Math.round(gender.female * 100)}%</div>
          </div>
        )}
      </div>

      <div className={styles.panel}>
        <h3 className={styles.h3}>Top <em>regions</em></h3>
        {regionsEmpty ? (
          <div style={emptyHint}>暂无地域分布数据 — 等待后台采集首批样本</div>
        ) : (
          regions.map((r) => (
            <div key={r.name} className={styles.barRow}>
              <div className={styles.lbl}>{r.name}</div>
              <div className={styles.track}><div className={styles.fill} style={{ width: `${r.pct * 100}%` }} /></div>
              <div className={styles.pct}>{Math.round(r.pct * 100)}%</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

import { useT } from "@/i18n/useT";
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
  const t = useT();
  const ageEntries = Object.entries(age);
  const ageEmpty = ageEntries.length === 0;
  const genderEmpty = gender.male === 0 && gender.female === 0;
  const regionsEmpty = regions.length === 0;
  return (
    <section className={styles.row}>
      <div className={styles.panel}>
        <h3 className={styles.h3}>{t("analytics.demoAgeTitle")} <em>{t("analytics.demoAgeEm")}</em></h3>
        {ageEmpty ? (
          <div style={emptyHint}>{t("analytics.demoEmptyAge")}</div>
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
        <h3 className={styles.h3}>{t("analytics.demoGenderTitle")} <em>{t("analytics.demoGenderEm")}</em></h3>
        {genderEmpty ? (
          <div style={emptyHint}>{t("analytics.demoEmptyGender")}</div>
        ) : (
          <div className={styles.legend}>
            <div className={styles.legendRow}><div className={styles.swatch} style={{ background: "var(--accent)" }} />{t("analytics.demoMale")} · {Math.round(gender.male * 100)}%</div>
            <div className={styles.legendRow}><div className={styles.swatch} style={{ background: "var(--surface-2)", border: "1px solid var(--glass-hi)" }} />{t("analytics.demoFemale")} · {Math.round(gender.female * 100)}%</div>
          </div>
        )}
      </div>

      <div className={styles.panel}>
        <h3 className={styles.h3}>{t("analytics.demoRegionsTitle")} <em>{t("analytics.demoRegionsEm")}</em></h3>
        {regionsEmpty ? (
          <div style={emptyHint}>{t("analytics.demoEmptyRegions")}</div>
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

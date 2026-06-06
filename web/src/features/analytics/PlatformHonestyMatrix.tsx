import { useT } from "@/i18n/useT";
import {
  getPlatformHonestyMatrix,
  type HonestyCell,
  type HonestyVerdict,
} from "@/lib/platform-honesty";
import styles from "./PlatformHonestyMatrix.module.css";

/**
 * PRD-0006 S2 — the 平台诚实矩阵 (platform-honesty matrix).
 *
 * A thin render shell over the `getPlatformHonestyMatrix` pure core. For each
 * of the four platforms the product talks about, it states the TRUE answer to
 * three questions: own data? audience demographics? trend feed real or LLM?
 * The verdict (yes | partial | no) drives a dot colour; the label is i18n.
 *
 * This is the surface that lets us delete the demographics cards honestly:
 * instead of a lying "等待采集" placeholder, the user sees exactly what each
 * platform can and can't give them.
 */
const dotClass: Record<HonestyVerdict, string> = {
  yes: styles.dotYes,
  partial: styles.dotPartial,
  no: styles.dotNo,
};

function Cell({ cell }: { cell: HonestyCell }) {
  const t = useT();
  return (
    <div className={styles.cell}>
      <span
        className={`${styles.dot} ${dotClass[cell.verdict]}`}
        data-verdict={cell.verdict}
        aria-hidden="true"
      />
      <span>{t(cell.labelKey)}</span>
    </div>
  );
}

export function PlatformHonestyMatrix() {
  const t = useT();
  const rows = getPlatformHonestyMatrix();

  return (
    <section
      className={styles.card}
      aria-label={`${t("analytics.matrix.title")} ${t("analytics.matrix.titleEm")}`}
    >
      <h2 className={styles.h2}>
        {t("analytics.matrix.title")} <em>{t("analytics.matrix.titleEm")}</em>
      </h2>
      <div className={styles.sub}>{t("analytics.matrix.sub")}</div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t("analytics.matrix.colPlatform")}</th>
            <th>{t("analytics.matrix.colOwnData")}</th>
            <th>{t("analytics.matrix.colDemographics")}</th>
            <th>{t("analytics.matrix.colTrendSource")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className={styles.platform}>{t(row.nameKey)}</td>
              <td>
                <Cell cell={row.ownData} />
              </td>
              <td>
                <Cell cell={row.demographics} />
              </td>
              <td>
                <Cell cell={row.trendSource} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.dot} ${styles.dotYes}`} aria-hidden="true" />
          {t("analytics.matrix.legendYes")}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.dot} ${styles.dotPartial}`} aria-hidden="true" />
          {t("analytics.matrix.legendPartial")}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.dot} ${styles.dotNo}`} aria-hidden="true" />
          {t("analytics.matrix.legendNo")}
        </span>
      </div>
    </section>
  );
}

import { compactNumber } from "@/lib/format";
import { useT } from "@/i18n/useT";
import styles from "./KPIBar.module.css";

/**
 * R104 F441 / F442 — KPIs are **lifetime averages per post**, not "today",
 * because that's the only thing the backend summary actually contains
 * (`avg_digg / avg_comment / engagement_rate`). The previous component
 * displayed "今日点赞" + a delta percentage, both of which were lies:
 * - `todayLikes/Comments` were keys the backend never returned → permanent 0
 * - `delta` percentages were never computed on the summary level → permanent — 0%
 *
 * Until backend ships day-over-day or time-windowed summaries, this bar
 * shows truthful averages with **no delta affordance** at all. Reintroduce
 * delta only when backend provides matching fields.
 */
interface Props {
  avgLikes: number;
  avgComments: number;
  engagement: number;
}

export function KPIBar({ avgLikes, avgComments, engagement }: Props) {
  const t = useT();
  return (
    <div className={styles.bar}>
      <KPI num={compactNumber(avgLikes)} lbl={t("analytics.kpiAvgLikes")} />
      <KPI num={compactNumber(avgComments)} lbl={t("analytics.kpiAvgComments")} />
      <KPI num={`${(engagement * 100).toFixed(1)}%`} lbl={t("analytics.kpiEngagement")} />
    </div>
  );
}

function KPI({ num, lbl }: { num: string; lbl: string }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.num}>{num}</div>
      <div className={styles.lbl}>{lbl}</div>
    </div>
  );
}

import clsx from "clsx";
import { compactNumber, fmtDelta } from "@/lib/format";
import { useT } from "@/i18n/useT";
import styles from "./KPIBar.module.css";

interface Props {
  todayLikes: number; likesDelta: number;
  todayComments: number; commentsDelta: number;
  engagement: number; engagementDelta: number;
}

export function KPIBar({ todayLikes, likesDelta, todayComments, commentsDelta, engagement, engagementDelta }: Props) {
  const t = useT();
  return (
    <div className={styles.bar}>
      <KPI num={compactNumber(todayLikes)} lbl={t("analytics.kpiTodayLikes")} delta={likesDelta} />
      <KPI num={compactNumber(todayComments)} lbl={t("analytics.kpiTodayComments")} delta={commentsDelta} />
      <KPI num={`${(engagement * 100).toFixed(1)}%`} lbl={t("analytics.kpiEngagement")} delta={engagementDelta} />
    </div>
  );
}

function KPI({ num, lbl, delta }: { num: string; lbl: string; delta: number }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.num}>{num}</div>
      <div className={styles.lbl}>{lbl}</div>
      <div className={clsx(styles.delta, delta < 0 && styles.deltaDown)}>{fmtDelta(delta)}</div>
    </div>
  );
}

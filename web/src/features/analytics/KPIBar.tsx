import clsx from "clsx";
import { compactNumber, fmtDelta } from "@/lib/format";
import styles from "./KPIBar.module.css";

interface Props {
  todayLikes: number; likesDelta: number;
  todayComments: number; commentsDelta: number;
  engagement: number; engagementDelta: number;
}

export function KPIBar({ todayLikes, likesDelta, todayComments, commentsDelta, engagement, engagementDelta }: Props) {
  return (
    <div className={styles.bar}>
      <KPI num={compactNumber(todayLikes)} lbl="Today Likes" delta={likesDelta} />
      <KPI num={compactNumber(todayComments)} lbl="Today Comments" delta={commentsDelta} />
      <KPI num={`${(engagement * 100).toFixed(1)}%`} lbl="Engagement" delta={engagementDelta} />
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

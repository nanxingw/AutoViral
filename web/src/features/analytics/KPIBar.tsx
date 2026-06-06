import type { ReactNode } from "react";
import { compactNumber } from "@/lib/format";
import { useT } from "@/i18n/useT";
import { followerTier, positionInBand } from "@/lib/benchmark";
import { BenchmarkBand } from "./BenchmarkBand";
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
  avgViews: number;
  avgLikes: number;
  avgComments: number;
  engagement: number;
  /**
   * Follower count drives the D2 benchmark tier (PRD-0006 S3). The engagement
   * KPI is placed inside a same-tier Douyin baseline band so "互动率 2.6%"
   * reads as a diagnostic statement instead of an isolated number.
   */
  followerCount: number;
  /** The user's platform — drives platform-correctness of the band. */
  platform?: "douyin" | "xiaohongshu" | "tiktok" | "youtube";
}

export function KPIBar({
  avgViews,
  avgLikes,
  avgComments,
  engagement,
  followerCount,
  platform = "douyin",
}: Props) {
  const t = useT();
  // PRD-0006 S3 — position the engagement KPI inside the same-tier baseline.
  // engagement is a fraction (0.026 = 2.6%), exactly what positionInBand wants.
  const engagementLabel = t("analytics.kpiEngagement");
  const engagementBenchmark = positionInBand(
    platform,
    followerTier(followerCount),
    "engagement",
    engagement,
  );
  return (
    <div className={styles.bar}>
      {/* PRD-0006 S1 — 平均播放 KPI sits alongside the existing avg
          likes/comments/engagement trio; sourced from the real on-disk
          summary.avgPlay (624 for the user's frozen scrape). */}
      <KPI num={compactNumber(avgViews)} lbl={t("analytics.kpiAvgViews")} />
      <KPI num={compactNumber(avgLikes)} lbl={t("analytics.kpiAvgLikes")} />
      <KPI num={compactNumber(avgComments)} lbl={t("analytics.kpiAvgComments")} />
      <KPI num={`${(engagement * 100).toFixed(1)}%`} lbl={engagementLabel}>
        <BenchmarkBand result={engagementBenchmark} metricLabel={engagementLabel} />
      </KPI>
    </div>
  );
}

function KPI({ num, lbl, children }: { num: string; lbl: string; children?: ReactNode }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.num}>{num}</div>
      <div className={styles.lbl}>{lbl}</div>
      {children}
    </div>
  );
}

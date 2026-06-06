import { useMemo } from "react";
import { compactNumber } from "@/lib/format";
import { useT, type MessageKey } from "@/i18n/useT";
import {
  deriveGrowthTrajectory,
  type Milestone,
} from "@/lib/growth-trajectory";
import styles from "./TrajectoryCard.module.css";

/**
 * PRD-0006 S11 — growth trajectory + next-milestone card. With only 5 followers
 * and 9 works, a retrospective chart is meaningless, so this card looks
 * *forward*: the next round milestone to aim at (e.g. "5 → 50 followers") plus
 * the real signposts already passed (works published, best play).
 *
 * The D1 extension (`deriveGrowthTrajectory`) owns all the math; this is the
 * thin rendering shell. HONESTY: every milestone is `isProjection`, so the card
 * carries a visible "target" badge — the goal is a target/estimate, never a
 * measured or forecast fact (we have no time-series, so we never invent an
 * ETA). The current / published / best-play numbers are the user's real
 * on-disk data, passed through truthfully.
 */
interface Props {
  followerCount: number;
  worksCount: number;
  bestPlay: number;
  totalReach: number;
}

export function TrajectoryCard({
  followerCount,
  worksCount,
  bestPlay,
  totalReach,
}: Props) {
  const t = useT();
  const { follower, reach, published, bestPlay: derivedBest } = useMemo(
    () =>
      deriveGrowthTrajectory({ followerCount, worksCount, bestPlay, totalReach }),
    [followerCount, worksCount, bestPlay, totalReach],
  );

  const goal = (m: Milestone, labelKey: MessageKey) => {
    const widthPct = Math.max(2, Math.min(100, m.progress * 100));
    return (
      <div className={styles.goal} key={m.kind}>
        <div className={styles.goalHead}>
          <span className={styles.goalLabel}>{t(labelKey)}</span>
          <div className={styles.fromTo}>
            <span className={styles.from}>{compactNumber(m.current)}</span>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
            <span className={styles.to}>{compactNumber(m.target)}</span>
          </div>
        </div>
        <div className={styles.barTrack}>
          <div
            className={styles.barFill}
            style={{ width: `${widthPct}%` }}
            aria-hidden="true"
          />
        </div>
        <span className={styles.remaining}>
          {t("analytics.trajectory.remaining", {
            count: compactNumber(m.remaining),
          })}
        </span>
      </div>
    );
  };

  return (
    <section
      className={styles.card}
      aria-label={t("analytics.trajectory.ariaLabel")}
    >
      <div className={styles.head}>
        <h2 className={styles.h2}>
          {t("analytics.trajectory.title")}{" "}
          <em>{t("analytics.trajectory.titleEm")}</em>
        </h2>
        {/* Honesty badge: this is a goal, not a measurement or forecast. */}
        <span className={styles.targetBadge}>
          {t("analytics.trajectory.targetBadge")}
        </span>
      </div>
      <p className={styles.sub}>{t("analytics.trajectory.sub")}</p>

      <div className={styles.goals}>
        {follower
          ? goal(follower, "analytics.trajectory.goalFollowers")
          : null}
        {reach ? goal(reach, "analytics.trajectory.goalReach") : null}
      </div>

      {/* Real already-reached signposts — straight off disk, never projected. */}
      <div className={styles.signposts}>
        <div className={styles.signpost}>
          <span className={styles.signpostVal}>{compactNumber(published)}</span>
          <span className={styles.signpostLbl}>
            {t("analytics.trajectory.signpostPublished")}
          </span>
        </div>
        <div className={styles.signpostSep} aria-hidden="true" />
        <div className={styles.signpost}>
          <span className={styles.signpostVal}>
            {compactNumber(derivedBest)}
          </span>
          <span className={styles.signpostLbl}>
            {t("analytics.trajectory.signpostBestPlay")}
          </span>
        </div>
      </div>
    </section>
  );
}

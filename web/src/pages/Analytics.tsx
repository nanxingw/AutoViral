import { useCreatorAnalytics } from "@/queries/analytics";
import { useHonestInsights } from "@/queries/analytics-insights";
import { useMemoryProfile } from "@/queries/memory";
import { KPIBar } from "@/features/analytics/KPIBar";
import { ProfileBar } from "@/features/analytics/ProfileBar";
import { WorkPerformanceTable } from "@/features/analytics/WorkPerformanceTable";
import { TrajectoryCard } from "@/features/analytics/TrajectoryCard";
import { PillarComparison } from "@/features/analytics/PillarComparison";
import { InsightsList } from "@/features/analytics/InsightsList";
import {
  HonestEmptyState,
  SampleDemographicBars,
} from "@/features/analytics/HonestEmptyState";
import { PlatformHonestyMatrix } from "@/features/analytics/PlatformHonestyMatrix";
import { useT, type MessageKey } from "@/i18n/useT";

/**
 * Hero status label is a function of the channel's actual health, not a
 * hard-coded "warming up". Five buckets keyed off engagement rate + activity
 * so a quiet channel reads "still cold" instead of misleading positivity.
 *
 * Returns an i18n key so the label translates with locale. Tests that
 * imported the EN string literals can update to compare against the key
 * or to t() the result. See e2e-report F38.
 *
 * R104 F441 — params renamed from `todayLikes / todayComments` (lifetime
 * averages were being mislabeled "today" because the backend summary only
 * ships lifetime aggregates). Signature stays numeric for test compat.
 *
 * Thresholds picked to land typical creator engagement (1–5%) in the middle
 * bucket; verify when we have real data feedback.
 */
export function audienceStatusLabel(engagement: number, avgLikes: number, avgComments: number): MessageKey {
  if (avgLikes === 0 && avgComments === 0 && engagement === 0) return "analytics.statusStillCold";
  if (engagement < 0.01) return "analytics.statusWarmingUp";
  if (engagement < 0.05) return "analytics.statusAliveAndWell";
  if (engagement < 0.10) return "analytics.statusHumming";
  return "analytics.statusOnFire";
}

export default function Analytics() {
  const a = useCreatorAnalytics();
  const m = useMemoryProfile();
  // PRD-0006 S12 — "最新洞察" come from a local agent reading the real works,
  // filtered server-side through D3 so no insight cites a never-measured metric.
  const ins = useHonestInsights();
  const t = useT();

  if (a.isLoading || m.isLoading) return <main className="page">{t("analytics.loading")}</main>;
  if (!a.data) return <main className="page">{t("analytics.empty")}</main>;

  const { account, summary, works } = a.data;
  // Prefer the D3-filtered agent insights; fall back to any insights already on
  // the creator snapshot. Both are honesty-gated — never a fabricated metric.
  const insights = (ins.data ?? []).length > 0 ? ins.data ?? [] : a.data.insights;
  // Map the adapter's snake_case works onto the D1 pure-core input shape.
  // These are the user's real frozen per-post metrics — pass them through
  // truthfully, no fabrication.
  const workMetrics = works.map((w) => ({
    desc: w.desc,
    playCount: w.play_count,
    diggCount: w.digg_count,
    commentCount: w.comment_count,
    shareCount: w.share_count,
    collectCount: w.collect_count,
  }));
  // S11 inputs — total reach + best play come straight off the real per-work
  // plays (no fabrication); follower/work counts come off the account.
  const totalReach = workMetrics.reduce((s, w) => s + w.playCount, 0);
  const bestPlay = workMetrics.reduce((m, w) => Math.max(m, w.playCount), 0);
  const statusKey = audienceStatusLabel(
    summary.engagementRate,
    summary.avgLikes,
    summary.avgComments,
  );
  const statusLabel = t(statusKey);
  // F4: under 1000 followers shouldn't read as "0K" — show the raw count.
  const followersDisplay =
    account.follower_count >= 1000
      ? `${(account.follower_count / 1000).toFixed(0)}K`
      : String(account.follower_count);
  return (
    <main className="page">
      <section style={{ padding: "40px 0 28px", display: "grid", gridTemplateColumns: "1fr auto", gap: 32, alignItems: "end" }}>
        <div>
          <span className="eyebrow">{t("analytics.heroEyebrow")}</span>
          <h1 style={{ fontSize: 44, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.05, margin: "12px 0 6px" }}>
            {t("analytics.audiencePrefix")} <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>{statusLabel}</em>{t("analytics.audienceSuffix")}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
            {account.nickname} · {followersDisplay} {t("analytics.followersSuffix")} · {account.aweme_count} {t("analytics.publishedWorksSuffix")}
          </div>
        </div>
        <KPIBar
          avgViews={summary.avgPlay}
          avgLikes={summary.avgLikes}
          avgComments={summary.avgComments}
          engagement={summary.engagementRate}
          followerCount={account.follower_count}
          platform="douyin"
        />
      </section>

      <ProfileBar nickname={account.nickname} followers={account.follower_count} tags={m.data?.tags ?? []} />
      <WorkPerformanceTable works={workMetrics} />

      {/* PRD-0006 S11 — growth trajectory + next milestone. With 5 followers and
          9 works a retrospective chart is meaningless, so this card looks
          forward: the next round goal (5 → 50 followers) framed explicitly as a
          target (never a measured/forecast fact), plus the real signposts
          already passed. Numbers are the user's real on-disk data. */}
      <TrajectoryCard
        followerCount={account.follower_count}
        worksCount={account.aweme_count}
        bestPlay={bestPlay}
        totalReach={totalReach}
      />

      {/* PRD-0006 S10 — content-pillar comparison. Tags the 9 works into a few
          deterministic pillars and aggregates per-pillar performance so the
          works become comparable ("你的 X 类是 Y 类的 N 倍"). Renders nothing
          until there are ≥2 distinct pillars. */}
      <PillarComparison works={workMetrics} />

      {/* PRD-0006 S2 — demographics are OAuth-only / unobtainable at this
          scale, so we DELETED the age/gender/region cards (they read fields no
          code ever wrote) and replaced them with an honest 3-part empty state.
          No CTA: the honest action is "use the real per-work table above", not
          a refresh that 501s. The platform-honesty matrix spells out why. */}
      <div style={{ marginBottom: 18 }}>
        <HonestEmptyState
          ariaLabel={t("analytics.emptyState.demographics.informTitle")}
          informTitle={t("analytics.emptyState.demographics.informTitle")}
          informBody={t("analytics.emptyState.demographics.informBody")}
          inspireLabel={t("analytics.emptyState.demographics.inspireLabel")}
          sample={<SampleDemographicBars />}
          activateTitle={t("analytics.emptyState.demographics.activateTitle")}
          activateBody={t("analytics.emptyState.demographics.activateBody")}
        />
      </div>

      <div style={{ marginBottom: 18 }}>
        <PlatformHonestyMatrix />
      </div>

      {/* Insights: render the real agent insights when present (S12 fills
          them); otherwise the honest empty state — no fabricated metrics, no
          "等待后台采集" lie, no 501 refresh CTA. */}
      {insights.length > 0 ? (
        <InsightsList items={insights} />
      ) : (
        <HonestEmptyState
          ariaLabel={t("analytics.emptyState.insights.informTitle")}
          informTitle={t("analytics.emptyState.insights.informTitle")}
          informBody={t("analytics.emptyState.insights.informBody")}
          inspireLabel={t("analytics.emptyState.insights.inspireLabel")}
          sample={t("analytics.emptyState.insights.inspireSample")}
          activateTitle={t("analytics.emptyState.insights.activateTitle")}
          activateBody={t("analytics.emptyState.insights.activateBody")}
        />
      )}
    </main>
  );
}

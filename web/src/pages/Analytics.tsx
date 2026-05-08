import { useCreatorAnalytics } from "@/queries/analytics";
import { useMemoryProfile } from "@/queries/memory";
import { KPIBar } from "@/features/analytics/KPIBar";
import { ProfileBar } from "@/features/analytics/ProfileBar";
import { DemographicsRow } from "@/features/analytics/DemographicsRow";
import { InsightsList } from "@/features/analytics/InsightsList";
import { useT } from "@/i18n/useT";

/**
 * Hero status label is a function of the channel's actual health, not a
 * hard-coded "warming up". Five buckets keyed off engagement rate + same-day
 * activity so a quiet day reads "still cold" instead of misleading positivity.
 *
 * Thresholds picked to land typical creator engagement (1–5%) in the middle
 * bucket; verify when we have real data feedback.
 */
export function audienceStatusLabel(engagement: number, todayLikes: number, todayComments: number): string {
  if (todayLikes === 0 && todayComments === 0 && engagement === 0) return "still cold";
  if (engagement < 0.01) return "warming up";
  if (engagement < 0.05) return "alive and well";
  if (engagement < 0.10) return "humming";
  return "on fire";
}

export default function Analytics() {
  const a = useCreatorAnalytics();
  const m = useMemoryProfile();
  const t = useT();

  if (a.isLoading || m.isLoading) return <main className="page">Loading…</main>;
  if (!a.data) return <main className="page">No analytics data.</main>;

  const { account, summary, demographics, insights } = a.data;
  const statusLabel = audienceStatusLabel(
    summary.engagementRate,
    summary.todayLikes,
    summary.todayComments,
  );
  const isEmpty =
    summary.todayLikes === 0 &&
    summary.todayComments === 0 &&
    summary.engagementRate === 0;

  return (
    <main className="page">
      <section style={{ padding: "40px 0 28px", display: "grid", gridTemplateColumns: "1fr auto", gap: 32, alignItems: "end" }}>
        <div>
          <span className="eyebrow">CHANNEL HEALTH · last 7 days</span>
          <h1 style={{ fontSize: 44, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.05, margin: "12px 0 6px" }}>
            Your audience is <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>{statusLabel}</em>.
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
            {account.nickname} · {(account.follower_count / 1000).toFixed(0)}K followers · {account.aweme_count} published works
          </div>
        </div>
        <KPIBar
          todayLikes={summary.todayLikes}
          likesDelta={summary.todayLikesDelta}
          todayComments={summary.todayComments}
          commentsDelta={summary.todayCommentsDelta}
          engagement={summary.engagementRate}
          engagementDelta={summary.engagementDelta}
        />
      </section>

      {isEmpty ? (
        <div
          style={{
            margin: "0 0 16px",
            padding: "10px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.04em",
            color: "var(--text-soft)",
            background: "var(--surface-1)",
            border: "1px solid var(--glass-border)",
            borderRadius: 8,
          }}
        >
          ⓘ {t("analytics.collectionNote")}
        </div>
      ) : null}

      <ProfileBar nickname={account.nickname} followers={account.follower_count} tags={m.data?.tags ?? []} />
      <DemographicsRow age={demographics.age} gender={demographics.gender} regions={demographics.regions} />
      <InsightsList items={insights} />
    </main>
  );
}

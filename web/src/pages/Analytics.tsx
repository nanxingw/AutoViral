import { useCreatorAnalytics } from "@/queries/analytics";
import { useMemoryProfile } from "@/queries/memory";
import { KPIBar } from "@/features/analytics/KPIBar";
import { ProfileBar } from "@/features/analytics/ProfileBar";
import { DemographicsRow } from "@/features/analytics/DemographicsRow";
import { InsightsList } from "@/features/analytics/InsightsList";

export default function Analytics() {
  const a = useCreatorAnalytics();
  const m = useMemoryProfile();

  if (a.isLoading || m.isLoading) return <main className="page">Loading…</main>;
  if (!a.data) return <main className="page">No analytics data.</main>;

  const { account, summary, demographics, insights } = a.data;

  return (
    <main className="page">
      <section style={{ padding: "40px 0 28px", display: "grid", gridTemplateColumns: "1fr auto", gap: 32, alignItems: "end" }}>
        <div>
          <span className="eyebrow">CHANNEL HEALTH · last 7 days</span>
          <h1 style={{ fontSize: 44, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.05, margin: "12px 0 6px" }}>
            Your audience is <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>warming up</em>.
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

      <ProfileBar nickname={account.nickname} followers={account.follower_count} tags={m.data?.tags ?? []} />
      <DemographicsRow age={demographics.age} gender={demographics.gender} regions={demographics.regions} />
      <InsightsList items={insights} />
    </main>
  );
}

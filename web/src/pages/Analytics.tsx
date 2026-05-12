import { useCreatorAnalytics } from "@/queries/analytics";
import { useMemoryProfile } from "@/queries/memory";
import { KPIBar } from "@/features/analytics/KPIBar";
import { ProfileBar } from "@/features/analytics/ProfileBar";
import { DemographicsRow } from "@/features/analytics/DemographicsRow";
import { InsightsList } from "@/features/analytics/InsightsList";
import { useT, type MessageKey } from "@/i18n/useT";
import { useSettingsPanelStore } from "@/stores/settings";

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
  const t = useT();

  if (a.isLoading || m.isLoading) return <main className="page">{t("analytics.loading")}</main>;
  if (!a.data) return <main className="page">{t("analytics.empty")}</main>;

  const { account, summary, demographics, insights } = a.data;
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
  const isEmpty =
    summary.avgLikes === 0 &&
    summary.avgComments === 0 &&
    summary.engagementRate === 0;

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
          avgLikes={summary.avgLikes}
          avgComments={summary.avgComments}
          engagement={summary.engagementRate}
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
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            ⓘ {t("analytics.collectionNote")}
          </span>
          {/* e2e-report F83: empty-state used to dead-end users at "check
              Python deps" with no in-app remediation. Open the existing
              Settings drawer focused on the douyin section so users can hit
              "Refresh now" / inspect the binding without leaving the page. */}
          <button
            type="button"
            onClick={() => useSettingsPanelStore.getState().openPanel("douyin")}
            style={{
              padding: "4px 10px",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
              border: "1px solid var(--glass-border)",
              background: "var(--surface-2)",
              color: "var(--text)",
              borderRadius: 6,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {t("analytics.openSettingsCta")} →
          </button>
        </div>
      ) : null}

      <ProfileBar nickname={account.nickname} followers={account.follower_count} tags={m.data?.tags ?? []} />
      <DemographicsRow age={demographics.age} gender={demographics.gender} regions={demographics.regions} />
      <InsightsList items={insights} />
    </main>
  );
}

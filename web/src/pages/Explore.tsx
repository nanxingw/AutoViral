import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PlatformTabs } from "@/features/explore/PlatformTabs";
import { AnglesCard, type Angle } from "@/features/explore/AnglesCard";
import { TrendingPanel } from "@/features/explore/TrendingPanel";
import { usePlatformTrends, type Platform } from "@/queries/trends";
import { apiFetch } from "@/lib/api";
import { useT } from "@/i18n/useT";

// Static recommendations — note marker rendered in AnglesCard so user knows
// these aren't algorithm output yet. Replace once a "generate angles" agent
// hook lands.
const STATIC_ANGLES: Angle[] = [
  { num: "01", body: "Why nobody is teaching X anymore — competitor gap detected, 3 of 5 top creators abandoned tutorial content.", score: "FIT 94 · 5.2K est. reach" },
  { num: "02", body: "An 18s carousel: \"The first 1.5 seconds of every viral short, ranked\". Hot retention pattern in your niche.", score: "FIT 87 · 3.8K est. reach" },
  { num: "03", body: "Hijack the #fyp · cooking · keyboards mash-up — niche cross-pollination spiking.", score: "FIT 79 · risky" },
];

export default function Explore() {
  const [platform, setPlatform] = useState<Platform>("youtube");
  const trends = usePlatformTrends(platform);
  const qc = useQueryClient();
  const t = useT();
  const [collecting, setCollecting] = useState(false);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);

  const collectTrends = async () => {
    setCollecting(true);
    setCollectMsg(null);
    try {
      // The /api/trends/refresh endpoint runs sync research on the supported
      // platforms and returns when the new yaml lands; we then nudge react-query.
      await apiFetch(`/api/trends/refresh`, {
        method: "POST",
        body: { platforms: ["xiaohongshu", "douyin"] },
      });
      setCollectMsg(t("explore.collectQueued"));
      qc.invalidateQueries({ queryKey: ["trends"] });
    } catch (e) {
      setCollectMsg(
        t("explore.collectFailed", {
          reason: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setCollecting(false);
    }
  };

  return (
    <main className="page">
      <section style={{ padding: "48px 0 32px" }}>
        <span className="eyebrow">{t("explore.heroEyebrow")}</span>
        <h1 className="h-display" style={{ fontSize: 52, lineHeight: 1.05, margin: "12px 0 14px", maxWidth: 880, fontWeight: 500 }}>
          {t("explore.heroLine1")}
          <br />
          {t("explore.heroLine2")}
        </h1>
        <div style={{ fontSize: 13, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span>
            {t("explore.aggregatedFrom")} <strong style={{ color: "var(--text)" }}>YouTube</strong>, <strong style={{ color: "var(--text)" }}>TikTok</strong>, 小红书, 抖音.
          </span>
          <button
            type="button"
            onClick={collectTrends}
            disabled={collecting}
            style={{
              padding: "5px 12px",
              fontSize: 11,
              borderRadius: 7,
              border: "1px solid var(--accent)",
              background: collecting ? "var(--surface-2)" : "var(--accent)",
              color: collecting ? "var(--text-dim)" : "var(--accent-fg)",
              cursor: collecting ? "wait" : "pointer",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
            }}
          >
            {collecting ? t("explore.collectInProgress") : `↻ ${t("explore.collectTrends")}`}
          </button>
          {collectMsg && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-soft)" }}>
              {collectMsg}
            </span>
          )}
        </div>
      </section>

      <AnglesCard angles={STATIC_ANGLES} note={t("explore.anglesNote")} />

      <PlatformTabs value={platform} onChange={setPlatform} />

      {trends.isLoading ? (
        <div style={{ color: "var(--text-dim)" }}>{t("explore.loadingTrends")}</div>
      ) : trends.data ? (
        <TrendingPanel platform={platform} items={trends.data.items} />
      ) : (
        <div style={{ color: "var(--text-dim)" }}>{t("explore.noTrendsData")}</div>
      )}
    </main>
  );
}

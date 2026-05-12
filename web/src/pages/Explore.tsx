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
// hook lands. Bodies pulled from i18n so demo content swaps with locale
// (FIT/est. reach kept as brand-term data labels — see e2e-report F41).
const SAMPLE_ANGLE_META = [
  { num: "01", score: "FIT 94 · 5.2K est. reach", bodyKey: "explore.sampleAngle1Body" },
  { num: "02", score: "FIT 87 · 3.8K est. reach", bodyKey: "explore.sampleAngle2Body" },
  { num: "03", score: "FIT 79 · risky", bodyKey: "explore.sampleAngle3Body" },
] as const;

export default function Explore() {
  // e2e-report F134: default to 小红书 (a SUPPORTED_REFRESH_PLATFORMS member)
  // so first-load shows real collected trend data instead of empty state.
  // YouTube/TikTok don't have a server-side collector yet (see F132); landing
  // on either of them gives users a "no data — click 立即采集" misdirection
  // because the refresh endpoint hardcodes ["xiaohongshu","douyin"] anyway.
  // Pick xiaohongshu over douyin: its YAML schema has views/likes/comments
  // (douyin is heat-based topics, less visually grounded for first paint).
  const [platform, setPlatform] = useState<Platform>("xiaohongshu");
  const trends = usePlatformTrends(platform);
  const qc = useQueryClient();
  const t = useT();
  const STATIC_ANGLES: Angle[] = SAMPLE_ANGLE_META.map((a) => ({
    num: a.num,
    score: a.score,
    body: t(a.bodyKey),
  }));
  const [collecting, setCollecting] = useState(false);
  // e2e-report F87: collectStatus splits the old single `collectMsg` into a
  // tagged union so the queued case can render as two-channel UI (done badge
  // + scheduled hint) instead of cramming three semantics ("done + pending +
  // 30s schedule") into one sentence.
  const [collectStatus, setCollectStatus] = useState<"idle" | "queued" | "failed">("idle");
  const [collectError, setCollectError] = useState<string | null>(null);

  const collectTrends = async () => {
    setCollecting(true);
    setCollectStatus("idle");
    setCollectError(null);
    try {
      // The /api/trends/refresh endpoint runs sync research on the supported
      // platforms and returns when the new yaml lands; we then nudge react-query.
      await apiFetch(`/api/trends/refresh`, {
        method: "POST",
        body: { platforms: ["youtube", "tiktok", "xiaohongshu", "douyin"] },
      });
      setCollectStatus("queued");
      qc.invalidateQueries({ queryKey: ["trends"] });
    } catch (e) {
      setCollectStatus("failed");
      setCollectError(e instanceof Error ? e.message : String(e));
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
            aria-busy={collecting}
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
          {collectStatus === "queued" && (
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11 }}>
              <strong style={{ color: "var(--status-done)", fontWeight: 600 }}>
                ✓ {t("explore.collectQueuedDone")}
              </strong>
              <span style={{ color: "var(--text-dimmer)" }}>
                {t("explore.collectQueuedHint")}
              </span>
            </span>
          )}
          {collectStatus === "failed" && collectError && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--status-error)" }}>
              {t("explore.collectFailed", { reason: collectError })}
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

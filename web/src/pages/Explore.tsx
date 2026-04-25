import { useState } from "react";
import { PlatformTabs } from "@/features/explore/PlatformTabs";
import { AnglesCard, type Angle } from "@/features/explore/AnglesCard";
import { TrendingPanel } from "@/features/explore/TrendingPanel";
import { usePlatformTrends, type Platform } from "@/queries/trends";

const STATIC_ANGLES: Angle[] = [
  { num: "01", body: "Why nobody is teaching X anymore — competitor gap detected, 3 of 5 top creators abandoned tutorial content.", score: "FIT 94 · 5.2K est. reach" },
  { num: "02", body: "An 18s carousel: \"The first 1.5 seconds of every viral short, ranked\". Hot retention pattern in your niche.", score: "FIT 87 · 3.8K est. reach" },
  { num: "03", body: "Hijack the #fyp · cooking · keyboards mash-up — niche cross-pollination spiking.", score: "FIT 79 · risky" },
];

export default function Explore() {
  const [platform, setPlatform] = useState<Platform>("youtube");
  const trends = usePlatformTrends(platform);

  return (
    <main className="page">
      <section style={{ padding: "48px 0 32px" }}>
        <span className="eyebrow">PULSE OF THE ALGORITHM</span>
        <h1 className="h-display" style={{ fontSize: 52, lineHeight: 1.05, margin: "12px 0 14px", maxWidth: 880, fontWeight: 500 }}>
          What's <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>moving</em> right now,
          <br />
          across the platforms <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>you care about</em>.
        </h1>
        <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
          Aggregated from <strong style={{ color: "var(--text)" }}>YouTube</strong>, <strong style={{ color: "var(--text)" }}>TikTok</strong>, 小红书, 抖音.
        </div>
      </section>

      <AnglesCard angles={STATIC_ANGLES} onRegenerate={() => { /* hook to chat in Plan 4 */ }} />

      <PlatformTabs value={platform} onChange={setPlatform} />

      {trends.isLoading ? (
        <div style={{ color: "var(--text-dim)" }}>Loading…</div>
      ) : trends.data ? (
        <TrendingPanel platform={platform} items={trends.data.items} />
      ) : (
        <div style={{ color: "var(--text-dim)" }}>No trends data.</div>
      )}
    </main>
  );
}

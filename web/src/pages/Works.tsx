import { useMemo, useState } from "react";
import { useWorks } from "@/queries/works";
import { WorksHero } from "@/features/works/WorksHero";
import { NewWorkCard } from "@/features/works/NewWorkCard";
import { WorksGrid } from "@/features/works/WorksGrid";
import { InsightRibbon, type Insight } from "@/features/works/InsightRibbon";
import { useT, type MessageKey } from "@/i18n/useT";

const PLACEHOLDER_INSIGHTS: Insight[] = [
  { tag: "COMPETITOR GAP", body: "Tutorial content under-served in your niche — 3 of 5 top creators have abandoned it.", date: "—", cta: "+ Generate Work →" },
  { tag: "AUDIENCE SIGNAL", body: "Your audience peak shifted to 8 PM weekdays — 2.3× engagement vs morning posts.", date: "—", cta: "Adjust Schedule →" },
  { tag: "STYLE RECOMMENDATION", body: "Warm color grading correlates with +18% retention across last 47 posts.", date: "—", cta: "Apply Preset →" },
];

type WorkFilter = "all" | "draft" | "published" | "archived";

export default function Works() {
  const works = useWorks();
  const [filter, setFilter] = useState<WorkFilter>("all");
  const list = works.data ?? [];
  const t = useT();

  const counts = useMemo(() => ({
    drafts: list.filter((w) => w.status === "draft").length,
    ideas: 0,
    unfinished: list.filter((w) => w.status === "draft" && w.type === "short-video").length,
  }), [list]);

  return (
    <main className="page">
      <WorksHero draftCount={counts.drafts} ideaCount={counts.ideas} unfinishedSceneCount={counts.unfinished} />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, margin: 0, fontWeight: 500, letterSpacing: "-0.02em" }}>
          My <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>Works</em>
          <span style={{ marginLeft: 12, fontFamily: "JetBrains Mono", fontSize: 11, color: "var(--text-dimmer)" }}>
            {list.length} TOTAL
          </span>
        </h2>
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "draft", "published", "archived"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              data-active={filter === f}
              style={{
                padding: "5px 12px", fontSize: 11, borderRadius: 7,
                border: "1px solid var(--glass-border)",
                background: filter === f ? "var(--surface-2)" : "transparent",
                color: filter === f ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {t(`works.filter.${f}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 56 }}>
        <NewWorkCard />
      </div>

      <WorksGrid works={list} filter={filter} />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, margin: 0, fontWeight: 500, letterSpacing: "-0.02em" }}>
          Latest <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>Inspiration</em>
        </h2>
      </div>
      <InsightRibbon insights={PLACEHOLDER_INSIGHTS} />
    </main>
  );
}

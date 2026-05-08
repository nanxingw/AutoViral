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
  const [query, setQuery] = useState("");
  const list = works.data ?? [];
  const t = useT();

  const counts = useMemo(() => ({
    drafts: list.filter((w) => w.status === "draft").length,
    ideas: 0,
    unfinished: list.filter((w) => w.status === "draft" && w.type === "short-video").length,
  }), [list]);

  // Search is a substring match on title; status filter is layered on top.
  // Both happen client-side because the works index is small (~tens) and
  // already sits in memory.
  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((w) => {
      if (filter !== "all" && w.status !== filter) return false;
      if (!q) return true;
      return w.title.toLowerCase().includes(q);
    });
  }, [list, filter, query]);

  return (
    <main className="page">
      <WorksHero draftCount={counts.drafts} ideaCount={counts.ideas} unfinishedSceneCount={counts.unfinished} />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 22, margin: 0, fontWeight: 500, letterSpacing: "-0.02em" }}>
          My <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>Works</em>
          <span style={{ marginLeft: 12, fontFamily: "JetBrains Mono", fontSize: 11, color: "var(--text-dimmer)" }}>
            {filteredList.length}/{list.length}
          </span>
        </h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: 12,
                fontSize: 13,
                color: "var(--text-dimmer)",
                pointerEvents: "none",
                lineHeight: 1,
              }}
            >
              ⌕
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("works.searchPlaceholder")}
              aria-label={t("works.searchPlaceholder")}
              style={{
                width: 320,
                padding: "9px 14px 9px 32px",
                fontSize: 13,
                borderRadius: 8,
                border: "1px solid var(--glass-border)",
                background: "var(--surface-0)",
                color: "var(--text)",
                fontFamily: "inherit",
                outline: "none",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--accent)";
                e.target.style.boxShadow = "0 0 0 3px var(--accent-glow)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "var(--glass-border)";
                e.target.style.boxShadow = "none";
              }}
            />
          </div>
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
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 56 }}>
        <NewWorkCard />
      </div>

      {filteredList.length === 0 && query.trim() ? (
        <div
          style={{
            padding: "24px 0",
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          {t("works.emptySearch", { query: `"${query.trim()}"` })}
        </div>
      ) : (
        <WorksGrid works={filteredList} filter="all" />
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, margin: 0, fontWeight: 500, letterSpacing: "-0.02em" }}>
          Latest <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>Inspiration</em>
        </h2>
      </div>
      <InsightRibbon insights={PLACEHOLDER_INSIGHTS} />
    </main>
  );
}

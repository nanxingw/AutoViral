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

type WorkFilter = "all" | "draft" | "processing" | "published" | "archived";

// "processing" is a UI bucket that covers the three transient backend statuses
// users never see as a dedicated chip otherwise (creating / ready / failed).
// Mirrored in WorksGrid.tsx — change both together. See e2e-report F10.
const PROCESSING_STATUSES = new Set(["creating", "ready", "failed"]);

export default function Works() {
  const works = useWorks();
  const [filter, setFilter] = useState<WorkFilter>("all");
  const [query, setQuery] = useState("");
  const list = works.data ?? [];
  const t = useT();

  const counts = useMemo(() => ({
    drafts: list.filter((w) => w.status === "draft").length,
    // R98 F403 — ideas field was hardcoded 0; dead branch removed from
    // WorksHero. If an ideas-queue stage is added later, re-introduce
    // this with a real source.
    unfinished: list.filter((w) => w.status === "draft" && w.type === "short-video").length,
  }), [list]);

  // e2e-report F192 (real cause, vs the R77 misread): "已发布"/"已归档" are
  // frontend-only enum buckets that the backend doesn't emit yet (see comment
  // in queries/works.ts). Clicking those pills always yields 0 cards but with
  // no surface signal, leaving the user staring at a blank grid wondering if
  // they're seeing it wrong. The fix is M111: surface per-bucket count on the
  // pill *before* the click, so users know "0 已发布" means "none yet" not
  // "filter broken". Same memo also feeds the empty-filter branch below.
  const filterCounts = useMemo(() => ({
    all: list.length,
    draft: list.filter((w) => w.status === "draft").length,
    processing: list.filter((w) => PROCESSING_STATUSES.has(w.status)).length,
    published: list.filter((w) => w.status === "published").length,
    archived: list.filter((w) => w.status === "archived").length,
  }), [list]);

  // Search is a substring match on title; status filter is layered on top.
  // Both happen client-side because the works index is small (~tens) and
  // already sits in memory.
  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((w) => {
      if (filter === "processing") {
        if (!PROCESSING_STATUSES.has(w.status)) return false;
      } else if (filter !== "all" && w.status !== filter) {
        return false;
      }
      if (!q) return true;
      return w.title.toLowerCase().includes(q);
    });
  }, [list, filter, query]);

  return (
    <main className="page">
      <WorksHero draftCount={counts.drafts} unfinishedSceneCount={counts.unfinished} />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 22, margin: 0, fontWeight: 500, letterSpacing: "-0.02em" }}>
          {t("works.h2WorksLead")} <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>{t("works.h2WorksEm")}</em>
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
            {/* R98 F395 — "published" / "archived" filter pills hidden until
               the backend actually emits those statuses (see
               queries/works.ts). Their counts are always 0, so they were
               occupying prime nav real estate while deceiving users into
               thinking publishing was a real feature. WorkFilter union
               keeps both members so URL-param re-entry stays type-safe
               if the feature comes back. */}
            {(["all", "draft", "processing"] as const).map((f) => {
              const n = filterCounts[f];
              const isEmpty = n === 0;
              const isActive = filter === f;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  data-active={isActive}
                  aria-pressed={isActive}
                  style={{
                    padding: "5px 12px", fontSize: 11, borderRadius: 7,
                    border: "1px solid var(--glass-border)",
                    background: isActive ? "var(--surface-2)" : "transparent",
                    color: isActive ? "var(--text)" : isEmpty ? "var(--text-dimmer)" : "var(--text-dim)",
                    cursor: "pointer", fontFamily: "inherit",
                    opacity: isEmpty && !isActive ? 0.55 : 1,
                  }}
                >
                  {t(`works.filter.${f}` as MessageKey)}
                  <span style={{ marginLeft: 6, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dimmer)" }}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* R98 F398 — grid was hardcoded `repeat(3, 1fr)`, which on a 2560px
         viewport left two empty columns (only NewWorkCard renders here).
         auto-fill + minmax matches WorksGrid below and lets the new-work
         card sit alongside future starter cards as the surface grows. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginBottom: 56 }}>
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
      ) : filteredList.length === 0 && filter !== "all" ? (
        // F192 real cause (not the R77 count-render misread): when a filter
        // pill yields 0 the grid otherwise renders blank, with no signal to
        // the user that the filter is the reason. Tell them what was filtered
        // and give a one-click escape back to "all".
        <div
          style={{
            padding: "24px 0",
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            flexWrap: "wrap",
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          <span>
            {t("works.emptyFilter", {
              label: t(`works.filter.${filter}` as MessageKey),
            })}
          </span>
          <button
            type="button"
            onClick={() => setFilter("all")}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              borderRadius: 6,
              border: "1px solid var(--glass-border)",
              background: "transparent",
              color: "var(--text)",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {t("works.clearFilter")}
          </button>
        </div>
      ) : list.length === 0 ? (
        // First-run empty: NewWorkCard is already visible above, but the
        // bare grid below feels abandoned. Render a soft editorial
        // pointer back up to the + card so new users have one obvious
        // next step instead of a barren page.
        <div
          style={{
            padding: "32px 0 8px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.6,
            borderTop: "1px dashed var(--glass-border)",
          }}
        >
          <span style={{ color: "var(--text)", fontFamily: "Instrument Serif, var(--font-serif)", fontStyle: "italic", fontSize: 18 }}>
            ↑ {t("works.emptyTitle")}
          </span>
          <span>{t("works.emptyBody")}</span>
        </div>
      ) : (
        <WorksGrid works={filteredList} filter="all" />
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, margin: 0, fontWeight: 500, letterSpacing: "-0.02em" }}>
          {t("works.h2InspirationLead")} <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>{t("works.h2InspirationEm")}</em>
        </h2>
      </div>
      <InsightRibbon insights={PLACEHOLDER_INSIGHTS} note={t("works.insightsRibbonNote")} />
    </main>
  );
}

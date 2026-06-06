/**
 * D1 — creator-analytics derivation pure core (PRD-0006 S1).
 *
 * The user's per-post Douyin metrics (play / digg / comment / share / collect)
 * are already on disk in `~/.autoviral/analytics/douyin/latest.json` and are
 * already parsed by the adapter (`web/src/queries/analytics.ts` → `works[]` +
 * `summary.avgPlay`), but the per-work numbers were never rendered. This is
 * the *built-not-wired* piece: a pure derivation from `works[] + summary` into
 *   - an `avgViews` KPI (prefers the on-disk summary average, else the floored
 *     mean of the real plays), and
 *   - sortable per-work performance rows.
 *
 * Honesty constraint: these are the user's real frozen works — derive, never
 * fabricate. No estimated retention/completion (AutoViral never measured it).
 *
 * Pure + UI-agnostic so it is unit-testable in isolation (see
 * `creator-analytics.test.ts`, which uses the frozen `latest.json` as fixture).
 */

/** A single work's raw metrics, as handed in by the analytics adapter. */
export interface WorkMetricInput {
  desc: string;
  playCount: number;
  diggCount: number;
  commentCount: number;
  shareCount: number;
  collectCount: number;
}

/** Summary aggregates as parsed by the adapter (lifetime averages). */
export interface CreatorSummaryInput {
  /** Backend `avg_play`; when present it is the source of truth for avgViews. */
  avgPlay?: number;
}

/** A derived, sortable performance row for one work. */
export interface WorkPerformanceRow {
  /** Stable key for React lists (index-derived; descs can collide/be empty). */
  id: string;
  desc: string;
  playCount: number;
  diggCount: number;
  commentCount: number;
  shareCount: number;
  collectCount: number;
}

/** Columns the per-work table can sort by (always descending). */
export type SortKey = "play" | "digg" | "comment" | "share" | "collect";

export interface CreatorAnalyticsDerived {
  /** Average views per post — the new "平均播放" KPI. */
  avgViews: number;
  /** One row per work, sorted by `sortKey` descending. */
  rows: WorkPerformanceRow[];
  /** The single highest-play work (by play count), or null when no works. */
  topByPlay: WorkPerformanceRow | null;
}

function metricFor(row: WorkPerformanceRow, key: SortKey): number {
  switch (key) {
    case "play":
      return row.playCount;
    case "digg":
      return row.diggCount;
    case "comment":
      return row.commentCount;
    case "share":
      return row.shareCount;
    case "collect":
      return row.collectCount;
  }
}

/**
 * Derive avgViews + sortable per-work rows from the parsed works + summary.
 *
 * @param works   per-post metrics (already adapter-normalised)
 * @param summary lifetime aggregates; `avgPlay` is preferred for avgViews
 * @param sortKey column to sort rows by, descending (default "play")
 */
export function deriveCreatorAnalytics(
  works: WorkMetricInput[],
  summary: CreatorSummaryInput,
  sortKey: SortKey = "play",
): CreatorAnalyticsDerived {
  const rows: WorkPerformanceRow[] = works.map((w, i) => ({
    id: `w${i}`,
    desc: w.desc ?? "",
    playCount: w.playCount ?? 0,
    diggCount: w.diggCount ?? 0,
    commentCount: w.commentCount ?? 0,
    shareCount: w.shareCount ?? 0,
    collectCount: w.collectCount ?? 0,
  }));

  // Prefer the truthful on-disk summary average; else floor the computed mean
  // to match how the backend rounds (avg_play=624 from 624.55…). Never invent
  // a number when there are no works.
  let avgViews = 0;
  if (typeof summary.avgPlay === "number" && Number.isFinite(summary.avgPlay)) {
    avgViews = summary.avgPlay;
  } else if (rows.length > 0) {
    const total = rows.reduce((sum, r) => sum + r.playCount, 0);
    avgViews = Math.floor(total / rows.length);
  }

  // Stable descending sort: ties keep their original relative order (works
  // arrive newest-first off the scrape, which is a sensible tiebreak).
  const sortedRows = rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((a, b) => {
      const diff = metricFor(b.row, sortKey) - metricFor(a.row, sortKey);
      return diff !== 0 ? diff : a.originalIndex - b.originalIndex;
    })
    .map((entry) => entry.row);

  const topByPlay =
    rows.length === 0
      ? null
      : rows.reduce((best, r) => (r.playCount > best.playCount ? r : best), rows[0]);

  return { avgViews, rows: sortedRows, topByPlay };
}

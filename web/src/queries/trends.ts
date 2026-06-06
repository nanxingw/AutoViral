// web/src/queries/trends.ts
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";

// Keep at top-level so the report query string is one source of truth.
const REPORT_PATH = (platform: Platform) => `/api/trends/${platform}/report`;

export type Platform = "youtube" | "tiktok" | "xiaohongshu" | "douyin";
export type ItemSource = "scraper" | "rss" | "agent_websearch" | "proxy";

// #82 — THE single source of truth for "which platforms have a live trend
// collector". Only 小红书 + 抖音 do: the /api/trends/refresh endpoint collects
// just these two (Explore.tsx) and 抖音 is the dedicated-script center
// (api.ts runTrendScript). YouTube/TikTok have no server-side collector, so
// they are NOT live — landing there shows trendingPanelUnsupported (which was
// dead code while this list held all 4). PlatformTabs derives its "live" dot
// from this list so the three surfaces (dot / refresh / unsupported copy)
// can't drift apart again.
export const SUPPORTED_REFRESH_PLATFORMS: readonly Platform[] = [
  "xiaohongshu", "douyin",
] as const;

export interface TrendItem {
  id: string;
  platform: Platform;
  title: string;
  sourceUrl: string;
  source: ItemSource;
  scrapedAt: string;
  cover: {
    url: string;
    aspect: "9:16" | "1:1" | "16:9";
    cachedPath?: string;
  };
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    fetchedAt: string;
  } | null;
  analysis: {
    heat: 1 | 2 | 3 | 4 | 5;
    competition: "低" | "中" | "高";
    opportunity: "金矿" | "蓝海" | "红海";
    description: string;
    tags: string[];
    contentAngles: string[];
    exampleHook: string;
    category: string;
  };
}

export interface TrendsResponse {
  platform: Platform;
  items: TrendItem[];
  // null when there is NO collected data (404). We refuse to default this to
  // `now` (S14/B2): pretending "just collected" for absent or month-old data was
  // the stale-served-as-live trust bug. A real timestamp only ever comes from
  // the server's freshness stamp on actually-on-disk data.
  collectedAt: string | null;
  pipelineStatus: "ok" | "partial" | "failed";
  /** Whole-days since collection (server-computed). 0 when unknown / no data. */
  ageDays: number;
  /** Server-flagged: data older than the freshness threshold — badge it. */
  stale: boolean;
}

export function coverUrlFor(platform: Platform, item: TrendItem): string {
  // Prefer locally cached image (server endpoint) to bypass CDN hotlink
  // protection. Fall back to remote URL when cache missed.
  return item.cover.cachedPath
    ? `/api/trends/${platform}/covers/${encodeURIComponent(item.id)}`
    : item.cover.url;
}

// ── S13 trend drill-down helpers ──────────────────────────────────────────

export type UrgencyLevel = "rising" | "breakout";
export interface TrendUrgency {
  level: UrgencyLevel;
  /** Suggested publish window in hours — surfaced as "publish within Xh". */
  windowHours: number;
}

// Derive a Rising/Breakout urgency badge from the ONLY signals we honestly
// have on every row: agent-rated heat (1-5) and opportunity class. We never
// invent platform velocity/growth-rate (no row carries that). Mapping:
//   heat 5, OR (heat 4 AND 金矿/high-heat-low-comp)  → breakout  (publish ≤72h)
//   heat 4 (any other opportunity)                   → rising    (publish ≤7d)
//   heat ≤3                                          → no badge
export function trendUrgency(item: TrendItem): TrendUrgency | null {
  const heat = item.analysis?.heat ?? 0;
  const opp = item.analysis?.opportunity;
  if (heat >= 5 || (heat >= 4 && opp === "金矿")) {
    return { level: "breakout", windowHours: 72 };
  }
  if (heat >= 4) return { level: "rising", windowHours: 168 };
  return null;
}

export interface SampleProvenance {
  /** Row content is LLM-fabricated (agent_websearch), not from a real collector. */
  inferred: boolean;
  /** Row carries real, on-disk platform metrics (not null, not fabricated). */
  hasRealMetrics: boolean;
  /** A real watchable example exists: real source + a usable url. */
  watchable: boolean;
}

// Provenance honesty (S13): 3 of 4 platforms are LLM-fabricated
// (source === "agent_websearch", null metrics); 小红书 has covers but null
// metrics. A row is "watchable" only when it came from a real collector AND
// has a usable source url — we never imply a watchable example for an inferred
// row, and never claim real metrics where there are none.
export function sampleProvenance(item: TrendItem): SampleProvenance {
  const inferred = item.source === "agent_websearch";
  const hasUrl = !!item.sourceUrl && /^https?:\/\//.test(item.sourceUrl);
  const m = item.metrics;
  const hasRealMetrics =
    !inferred &&
    !!m &&
    (m.views != null || m.likes != null || m.comments != null);
  return { inferred, hasRealMetrics, watchable: !inferred && hasUrl };
}

// GET /api/trends/:platform/report — the markdown research report the agent
// already writes to ~/.autoviral/trends/<platform>/report.md. Zero UI callers
// existed before S13; this surfaces it on demand (only fetched when a
// drill-down opens). 404 (no report yet) resolves to null, not an error.
export function useTrendReport(platform: Platform, enabled: boolean) {
  return useQuery({
    queryKey: ["trend-report", platform],
    enabled,
    queryFn: async (): Promise<string | null> => {
      try {
        const text = await apiFetch<string>(REPORT_PATH(platform));
        const trimmed = typeof text === "string" ? text.trim() : "";
        return trimmed.length > 0 ? trimmed : null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function usePlatformTrends(platform: Platform) {
  return useQuery({
    queryKey: ["trends", platform],
    queryFn: async (): Promise<TrendsResponse> => {
      try {
        const raw = await apiFetch<any>(`/api/trends/${platform}`);
        return {
          platform,
          items: Array.isArray(raw?.items) ? raw.items : [],
          // Honor the server's collectedAt; never substitute `now` (S14/B2).
          collectedAt: typeof raw?.collectedAt === "string" ? raw.collectedAt : null,
          pipelineStatus: raw?.pipelineStatus ?? "ok",
          ageDays: typeof raw?.ageDays === "number" ? raw.ageDays : 0,
          stale: raw?.stale === true,
        };
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // No data on disk → honestly empty, NOT "freshly collected just now".
          return { platform, items: [], collectedAt: null, pipelineStatus: "ok", ageDays: 0, stale: false };
        }
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

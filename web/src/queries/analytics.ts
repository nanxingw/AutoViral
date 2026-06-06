import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export const CREATOR_ANALYTICS_QUERY_KEY = ["analytics", "creator"] as const;

/**
 * R104 F441 / F442 / F443 (CRITICAL silent leak) — backend
 * `/api/analytics/creator` returns:
 *   { configured, data: { platform, account, works, summary, demographics, insights }, delta }
 * where `summary` actually contains **lifetime averages** keyed in snake_case:
 *   { total_works_collected, avg_play, avg_digg, avg_comment, avg_share,
 *     avg_collect, engagement_rate }
 *
 * The previous adapter read `d.summary?.todayLikes ?? 0` etc. — keys that
 * **never existed** in the backend payload — so every KPI was fallback 0
 * forever, regardless of real audience. Same for `todayLikesDelta` etc.;
 * the backend `delta` block only exposes `{ followers, favorited }`
 * (account-level, not summary-level).
 *
 * Now we map to truthful field names: `avgLikes / avgComments / avgPlay /
 * totalWorks / engagementRate` for the summary, and surface `delta` as a
 * separate top-level field so ProfileBar can show a follower change badge.
 */

export interface CreatorAnalytics {
  account: { nickname: string; follower_count: number; total_favorited: number; aweme_count: number };
  /**
   * **Lifetime averages**, not today/7d. Backend writes one summary per
   * collection run; until backend gains time-windowed aggregates, UI must
   * present these as "自有记录以来 / lifetime" rather than "近 7 天".
   */
  summary: {
    avgLikes: number;
    avgComments: number;
    avgPlay: number;
    engagementRate: number;
    totalWorks: number;
  };
  works: {
    desc: string;
    play_count: number;
    digg_count: number;
    comment_count: number;
    share_count: number;
    collect_count: number;
  }[];
  demographics: {
    age: Record<string, number>;
    gender: { male: number; female: number };
    regions: { name: string; pct: number }[];
  };
  insights: { date: string; body: string; tag: string }[];
  /**
   * Account-level day-over-day delta (signed). `null` until two snapshots
   * have been collected. Per-KPI deltas don't exist server-side — don't
   * fabricate them in the UI.
   */
  delta: { followers: number; favorited: number } | null;
}

interface BackendAnalyticsSummary {
  total_works_collected?: number;
  avg_play?: number;
  avg_digg?: number;
  avg_comment?: number;
  avg_share?: number;
  avg_collect?: number;
  engagement_rate?: number;
}

interface BackendAnalytics {
  configured: boolean;
  data?: {
    platform: string;
    account: CreatorAnalytics["account"];
    works: any[];
    summary?: BackendAnalyticsSummary;
    demographics?: Partial<CreatorAnalytics["demographics"]>;
    insights?: CreatorAnalytics["insights"];
  };
  delta?: { followers?: number; favorited?: number } | null;
}

function adapt(raw: BackendAnalytics): CreatorAnalytics | null {
  if (!raw?.data?.account) return null;
  const d = raw.data;
  const s = d.summary ?? {};
  const rawDelta = raw.delta;
  return {
    account: d.account,
    works: (d.works ?? []).map((w: any) => ({
      desc: w.desc ?? "",
      play_count: w.play_count ?? 0,
      digg_count: w.digg_count ?? 0,
      comment_count: w.comment_count ?? 0,
      share_count: w.share_count ?? 0,
      collect_count: w.collect_count ?? 0,
    })),
    summary: {
      avgLikes: s.avg_digg ?? 0,
      avgComments: s.avg_comment ?? 0,
      avgPlay: s.avg_play ?? 0,
      engagementRate: s.engagement_rate ?? 0,
      totalWorks: s.total_works_collected ?? 0,
    },
    demographics: {
      age: d.demographics?.age ?? {},
      gender: d.demographics?.gender ?? { male: 0, female: 0 },
      regions: d.demographics?.regions ?? [],
    },
    insights: d.insights ?? [],
    delta:
      rawDelta && typeof rawDelta === "object"
        ? {
            followers: rawDelta.followers ?? 0,
            favorited: rawDelta.favorited ?? 0,
          }
        : null,
  };
}

export function useCreatorAnalytics() {
  return useQuery({
    queryKey: CREATOR_ANALYTICS_QUERY_KEY,
    queryFn: async () => {
      const raw = await apiFetch<BackendAnalytics>("/api/analytics/creator");
      return adapt(raw);
    },
    staleTime: 60_000,
  });
}

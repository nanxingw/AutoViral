// web/src/queries/trends.ts
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";

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
  collectedAt: string;
  pipelineStatus: "ok" | "partial" | "failed";
}

export function coverUrlFor(platform: Platform, item: TrendItem): string {
  // Prefer locally cached image (server endpoint) to bypass CDN hotlink
  // protection. Fall back to remote URL when cache missed.
  return item.cover.cachedPath
    ? `/api/trends/${platform}/covers/${encodeURIComponent(item.id)}`
    : item.cover.url;
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
          collectedAt: raw?.collectedAt ?? new Date().toISOString(),
          pipelineStatus: raw?.pipelineStatus ?? "ok",
        };
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return { platform, items: [], collectedAt: new Date().toISOString(), pipelineStatus: "ok" };
        }
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

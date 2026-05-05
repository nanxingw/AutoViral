import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";

export type Platform = "youtube" | "tiktok" | "xiaohongshu" | "douyin";

export interface TrendItem {
  rank: number;
  title: string;
  views: number;
  likes: number;
  comments: number;
  change: number;
  thumbAspect: "9:16" | "16:9" | "1:1";
}

export interface TrendsResponse {
  platform: Platform;
  items: TrendItem[];
  refreshedAt: string;
}

// Backend returns different shapes per platform:
//   xiaohongshu → { videos: [{ title, views: "238万", likes, comments, ... }] }
//   douyin      → { topics: [{ rank, title, heat, competition, ... }] }
//   youtube/tiktok → 404 (no data)
// Each platform gets its own normaliser into TrendItem[].
function parseChineseUnit(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const s = String(v).trim();
  const num = parseFloat(s);
  if (isNaN(num)) return 0;
  if (s.includes("亿")) return Math.round(num * 100_000_000);
  if (s.includes("万") || s.includes("w") || s.includes("W")) return Math.round(num * 10_000);
  if (s.includes("k") || s.includes("K")) return Math.round(num * 1_000);
  return Math.round(num);
}

function adapt(platform: Platform, raw: any): TrendsResponse {
  const empty: TrendsResponse = { platform, items: [], refreshedAt: new Date().toISOString() };
  if (!raw) return empty;

  // xiaohongshu shape
  if (Array.isArray(raw.videos)) {
    return {
      ...empty,
      items: raw.videos.slice(0, 20).map((v: any, i: number): TrendItem => ({
        rank: i + 1,
        title: v.title ?? `Trend ${i + 1}`,
        views: parseChineseUnit(v.views),
        likes: parseChineseUnit(v.likes),
        comments: parseChineseUnit(v.comments),
        change: 0,
        thumbAspect: "9:16",
      })),
    };
  }
  // douyin shape (heat-based topics)
  if (Array.isArray(raw.topics)) {
    return {
      ...empty,
      items: raw.topics.slice(0, 20).map((t: any, i: number): TrendItem => ({
        rank: t.rank ?? i + 1,
        title: t.title ?? `Trend ${i + 1}`,
        views: 0,
        likes: (t.heat ?? 0) * 1000,
        comments: 0,
        change: 0,
        thumbAspect: "9:16",
      })),
    };
  }
  // already-normalised shape
  if (Array.isArray(raw.items)) return raw;
  return empty;
}

export function usePlatformTrends(platform: Platform) {
  return useQuery({
    queryKey: ["trends", platform],
    queryFn: async (): Promise<TrendsResponse> => {
      try {
        const raw = await apiFetch<unknown>(`/api/trends/${platform}`);
        return adapt(platform, raw);
      } catch (err) {
        // 404 is "no data yet", not a hard error — return an empty list so the
        // panel renders an empty state instead of white-screening when the user
        // clicks a platform tab.
        if (err instanceof ApiError && err.status === 404) {
          return { platform, items: [], refreshedAt: new Date().toISOString() };
        }
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

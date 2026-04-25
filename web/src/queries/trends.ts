import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

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

export function usePlatformTrends(platform: Platform) {
  return useQuery({
    queryKey: ["trends", platform],
    queryFn: () => apiFetch<TrendsResponse>(`/api/trends/${platform}`),
    staleTime: 5 * 60_000,
  });
}

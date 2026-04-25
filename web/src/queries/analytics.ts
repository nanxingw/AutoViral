import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface CreatorAnalytics {
  account: { nickname: string; follower_count: number; total_favorited: number; aweme_count: number };
  summary: { todayLikes: number; todayComments: number; engagementRate: number; todayLikesDelta: number; todayCommentsDelta: number; engagementDelta: number };
  works: { desc: string; play_count: number; digg_count: number; comment_count: number }[];
  demographics: {
    age: Record<string, number>;
    gender: { male: number; female: number };
    regions: { name: string; pct: number }[];
  };
  insights: { date: string; body: string; tag: string }[];
}

export function useCreatorAnalytics() {
  return useQuery({
    queryKey: ["analytics", "creator"],
    queryFn: () => apiFetch<CreatorAnalytics>("/api/analytics/creator"),
    staleTime: 60_000,
  });
}

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// Backend `/api/analytics/creator` shape (real):
//   { configured, data: { platform, account, works, summary, ... }, delta }
// We re-shape to a flat object the page already expects so older components
// stay untouched.

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

interface BackendAnalytics {
  configured: boolean;
  data?: {
    platform: string;
    account: CreatorAnalytics["account"];
    works: any[];
    summary?: Partial<CreatorAnalytics["summary"]>;
    demographics?: Partial<CreatorAnalytics["demographics"]>;
    insights?: CreatorAnalytics["insights"];
  };
  delta?: any;
}

function adapt(raw: BackendAnalytics): CreatorAnalytics | null {
  if (!raw?.data?.account) return null;
  const d = raw.data;
  return {
    account: d.account,
    works: (d.works ?? []).map((w: any) => ({
      desc: w.desc ?? "",
      play_count: w.play_count ?? 0,
      digg_count: w.digg_count ?? 0,
      comment_count: w.comment_count ?? 0,
    })),
    summary: {
      todayLikes: d.summary?.todayLikes ?? 0,
      todayComments: d.summary?.todayComments ?? 0,
      engagementRate: d.summary?.engagementRate ?? 0,
      todayLikesDelta: d.summary?.todayLikesDelta ?? 0,
      todayCommentsDelta: d.summary?.todayCommentsDelta ?? 0,
      engagementDelta: d.summary?.engagementDelta ?? 0,
    },
    demographics: {
      age: d.demographics?.age ?? {},
      gender: d.demographics?.gender ?? { male: 0, female: 0 },
      regions: d.demographics?.regions ?? [],
    },
    insights: d.insights ?? [],
  };
}

export function useCreatorAnalytics() {
  return useQuery({
    queryKey: ["analytics", "creator"],
    queryFn: async () => {
      const raw = await apiFetch<BackendAnalytics>("/api/analytics/creator");
      return adapt(raw);
    },
    staleTime: 60_000,
  });
}

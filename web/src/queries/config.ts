import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { CREATOR_ANALYTICS_QUERY_KEY } from "./analytics";

type RawConfigResponse = {
  jimengAccessKey?: string;
  jimengSecretKey?: string;
  openrouterKey?: string;
  douyinUrl?: string;
  researchEnabled?: boolean;
  researchCron?: string;
  model?: string;
  analyticsLastCollectedAt?: string | null;
  research?: { enabled?: boolean; schedule?: string }; // legacy nested shape from older server
};

export interface AppConfig {
  jimengAccessKey: string;
  jimengSecretKey: string;
  openrouterKey: string;
  douyinUrl: string;
  researchEnabled: boolean;
  researchCron: string;
  model: string;
  // Last analytics collection timestamp (read from latest.json), optional
  analyticsLastCollectedAt?: string | null;
}

export type ConfigPatch = Partial<Omit<AppConfig, "analyticsLastCollectedAt">>;

const CONFIG_QUERY_KEY = ["config"] as const;

export function useConfig() {
  return useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: async () => {
      const raw = await apiFetch<RawConfigResponse>("/api/config");
      return {
        jimengAccessKey: raw.jimengAccessKey ?? "",
        jimengSecretKey: raw.jimengSecretKey ?? "",
        openrouterKey: raw.openrouterKey ?? "",
        douyinUrl: raw.douyinUrl ?? "",
        researchEnabled: Boolean(raw.researchEnabled ?? raw.research?.enabled ?? false),
        researchCron: raw.researchCron ?? raw.research?.schedule ?? "7 9,21 * * *",
        model: raw.model ?? "sonnet",
        analyticsLastCollectedAt: raw.analyticsLastCollectedAt ?? null,
      } satisfies AppConfig;
    },
    staleTime: 60_000,
  });
}

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ConfigPatch) =>
      apiFetch<AppConfig>("/api/config", { method: "PUT", body: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    },
  });
}

export interface RefreshResult {
  collectedAt: string;
  worksCount: number;
}

export function useRefreshAnalytics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<RefreshResult>("/api/analytics/refresh", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
      qc.invalidateQueries({ queryKey: CREATOR_ANALYTICS_QUERY_KEY });
    },
  });
}

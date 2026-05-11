import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

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
      const raw = await apiFetch<Record<string, unknown>>("/api/config");
      return {
        jimengAccessKey: (raw.jimengAccessKey as string) ?? "",
        jimengSecretKey: (raw.jimengSecretKey as string) ?? "",
        openrouterKey: (raw.openrouterKey as string) ?? "",
        douyinUrl: (raw.douyinUrl as string) ?? "",
        researchEnabled: Boolean(raw.researchEnabled ?? (raw as any).research?.enabled ?? false),
        researchCron: (raw.researchCron as string) ?? ((raw as any).research?.schedule as string) ?? "0 9 * * *",
        model: (raw.model as string) ?? "sonnet",
        analyticsLastCollectedAt: (raw.analyticsLastCollectedAt as string) ?? null,
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
      qc.invalidateQueries({ queryKey: ["creator-analytics"] });
    },
  });
}

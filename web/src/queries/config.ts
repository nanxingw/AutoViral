import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { CREATOR_ANALYTICS_QUERY_KEY } from "./analytics";

/**
 * R109 F475 — `/api/config` GET no longer round-trips secret plaintext.
 * `secretMeta[k]` ships `{ set: boolean; lastFour: string }` so the UI can
 * show "Currently stored ····AKLT" affordance without ever holding the
 * real value in browser memory. The plaintext `openrouterKey` field stays
 * in the response shape (always `""`) so older clients don't crash on
 * `undefined`.
 */
export interface SecretMetaEntry {
  set: boolean;
  lastFour: string;
}

export type SecretMeta = {
  openrouterKey: SecretMetaEntry;
};

type RawConfigResponse = {
  openrouterKey?: string;
  secretMeta?: Partial<SecretMeta>;
  douyinUrl?: string;
  researchEnabled?: boolean;
  researchCron?: string;
  model?: string;
  analyticsLastCollectedAt?: string | null;
  research?: { enabled?: boolean; schedule?: string }; // legacy nested shape from older server
};

export interface AppConfig {
  openrouterKey: string;
  /**
   * R109 F475 — non-null when server responds with redaction-aware
   * payload; legacy server (or msw fixture missing the field) falls back
   * to a "no metadata, treat as unset" entry so UI degrades gracefully.
   */
  secretMeta: SecretMeta;
  douyinUrl: string;
  researchEnabled: boolean;
  researchCron: string;
  model: string;
  // Last analytics collection timestamp (read from latest.json), optional
  analyticsLastCollectedAt?: string | null;
}

const UNSET_META: SecretMetaEntry = { set: false, lastFour: "" };

export type ConfigPatch = Partial<Omit<AppConfig, "analyticsLastCollectedAt" | "secretMeta">>;

const CONFIG_QUERY_KEY = ["config"] as const;

export function useConfig() {
  return useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: async () => {
      const raw = await apiFetch<RawConfigResponse>("/api/config");
      return {
        openrouterKey: raw.openrouterKey ?? "",
        secretMeta: {
          openrouterKey: raw.secretMeta?.openrouterKey ?? UNSET_META,
        },
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

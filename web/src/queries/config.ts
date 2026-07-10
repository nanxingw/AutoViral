import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

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
  model?: string;
};

export interface AppConfig {
  openrouterKey: string;
  /**
   * R109 F475 — non-null when server responds with redaction-aware
   * payload; legacy server (or msw fixture missing the field) falls back
   * to a "no metadata, treat as unset" entry so UI degrades gracefully.
   */
  secretMeta: SecretMeta;
  model: string;
}

const UNSET_META: SecretMetaEntry = { set: false, lastFour: "" };

export type ConfigPatch = Partial<Omit<AppConfig, "secretMeta">>;

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
        model: raw.model ?? "sonnet",
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

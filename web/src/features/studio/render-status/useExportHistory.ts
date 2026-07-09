import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { RenderJobView } from "./useRenderJob";

/**
 * S6 (PRD-0012 / issue 027 root-cause 5) — a render job as returned by
 * GET /api/works/:id/render/jobs. Superset of RenderJobView (adds the
 * fields the history list needs that the live-progress view doesn't:
 * workId/type/presetId/createdAt/finishedAt).
 */
export interface ExportHistoryJob {
  id: string;
  workId: string;
  type: "full" | "proxy";
  presetId?: string;
  status: RenderJobView["status"];
  progress: number;
  outputPath?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * Render history for a single work, newest first (server already sorts).
 * Mirrors useCheckpoints' shape (`items` + `isLoading`) and its `enabled`
 * gate — the dropdown only fetches once the menu is actually opened.
 */
export function useExportHistory(workId: string, enabled = true) {
  const query = useQuery({
    queryKey: ["export-history", workId],
    queryFn: () =>
      apiFetch<{ jobs: ExportHistoryJob[] }>(`/api/works/${workId}/render/jobs`),
    enabled,
    staleTime: 5_000,
  });

  return {
    items: query.data?.jobs ?? [],
    isLoading: query.isLoading,
  };
}

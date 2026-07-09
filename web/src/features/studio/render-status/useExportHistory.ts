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
 *
 * codex review (S6 finding, medium x2):
 *  - `staleTime: 0` — a menu re-open must always re-fetch. The previous
 *    5s staleTime meant closing the menu right after a render finished and
 *    reopening it within that window served the STALE pre-completion list
 *    (PRD-0012 S6's "close the popup, find the file in history" contract
 *    depends on the reopen being fresh).
 *  - `isError`/`error` — GET /render/jobs 503s with `errorCode:
 *    render_queue_unavailable` when the RenderQueue hasn't initialized yet.
 *    That is a DIFFERENT state from "this work genuinely has zero render
 *    history" (empty `jobs: []`, 200 OK) — exposing isError lets the menu
 *    render a distinct error state instead of collapsing both into the same
 *    "no renders yet" copy.
 */
export function useExportHistory(workId: string, enabled = true) {
  const query = useQuery({
    queryKey: ["export-history", workId],
    queryFn: () =>
      apiFetch<{ jobs: ExportHistoryJob[] }>(`/api/works/${workId}/render/jobs`),
    enabled,
    staleTime: 0,
  });

  return {
    items: query.data?.jobs ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

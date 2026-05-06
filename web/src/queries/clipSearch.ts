import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ── Wire shapes ──────────────────────────────────────────────────────────────

export interface ClipSearchHit {
  /** Either a relative path (e.g. "assets/images/foo.png") or a fully-formed
   *  /api/works/:id/assets/... URL — depends on what the Python script emits. */
  uri: string;
  kind: "image" | "video";
  score: number;
  /** Optional video mid-frame jpg path (filesystem absolute). v1 UI ignores. */
  frameSrc?: string;
}
export interface ClipSearchOk {
  stub: false;
  results: ClipSearchHit[];
  searchMs: number;
}
export interface ClipStub {
  stub: true;
  reason?: string;
  [k: string]: unknown;
}
export type ClipSearchResponse = ClipSearchOk | ClipStub;

export interface ClipIndexStatusOk {
  stub: false;
  model: string;
  assetCount: number;
  indexedAt: string;
  embeddingDim?: number;
}
export type ClipIndexStatus = ClipIndexStatusOk | ClipStub;

export interface ClipBuildOk {
  ok: true;
  stub: false;
  assetCount: number;
  model: string;
  indexedAt: string;
  durationMs: number;
}
export type ClipBuildResult = ClipBuildOk | ClipStub;

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useClipIndexStatus(workId: string | null) {
  return useQuery({
    queryKey: ["clip-index-status", workId],
    enabled: !!workId,
    queryFn: () =>
      apiFetch<ClipIndexStatus>(
        `/api/clip-index/status?workId=${encodeURIComponent(workId ?? "")}`,
      ),
  });
}

export function useClipSearch(
  workId: string | null,
  debouncedQuery: string,
  topK = 20,
) {
  return useQuery({
    queryKey: ["assets-search", workId, debouncedQuery, topK],
    enabled: !!workId && !!debouncedQuery && debouncedQuery.length >= 2,
    queryFn: () =>
      apiFetch<ClipSearchResponse>(
        `/api/works/${workId}/assets/search?q=${encodeURIComponent(debouncedQuery)}&topK=${topK}`,
      ),
  });
}

export function useBuildClipIndex(workId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["clip-index-build", workId],
    mutationFn: () =>
      apiFetch<ClipBuildResult>(`/api/clip-index/build`, {
        method: "POST",
        body: { workId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clip-index-status", workId] });
      qc.invalidateQueries({ queryKey: ["assets-search", workId] });
    },
  });
}

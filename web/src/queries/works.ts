import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { WorkType } from "@shared/content-types/registry";

export interface WorkSummary {
  id: string;
  title: string;
  // I06 / ADR-006 — the content-type union is owned by the shared registry.
  type: WorkType;
  // Backend statuses (src/work-store.ts WorkStatus) + frontend filter-only statuses
  // ("published" / "archived" are UI groupings that don't yet exist server-side).
  status: "draft" | "creating" | "ready" | "failed" | "published" | "archived";
  thumbnail: string | null;
  /** Backend-attached preview asset URL (image or video). May be undefined for empty works. */
  coverImage?: string | null;
  /** True when coverImage points to a video (last-resort fallback when no image asset exists). */
  coverIsVideo?: boolean;
  updatedAt: string;
}

export interface CreateWorkInput {
  title: string;
  type: WorkSummary["type"];
  platforms?: string[];
  // #65 — the creative brief / 选题方向 that drives the agent's research +
  // output (server consumes work.topicHint in ws-bridge buildContext and the
  // agent prompt; falls back to title when absent). useCreateWork spreads the
  // whole input, so adding the field here is enough to make it reachable.
  topicHint?: string;
}

export const worksKey = ["works"] as const;

const DEFAULT_PLATFORMS = ["douyin", "xiaohongshu"];

export function useWorks() {
  return useQuery({
    queryKey: worksKey,
    queryFn: async () => {
      const res = await apiFetch<{ works: WorkSummary[] } | WorkSummary[]>("/api/works");
      return Array.isArray(res) ? res : res.works;
    },
  });
}

export function useCreateWork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkInput) =>
      apiFetch<WorkSummary>("/api/works", {
        method: "POST",
        body: { ...input, platforms: input.platforms ?? DEFAULT_PLATFORMS },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: worksKey }),
  });
}

export function useUpdateWork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<WorkSummary> & { id: string }) =>
      apiFetch<WorkSummary>(`/api/works/${id}`, { method: "PUT", body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: worksKey }),
  });
}

export function useDeleteWork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ deleted: true }>(`/api/works/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worksKey });
    },
  });
}

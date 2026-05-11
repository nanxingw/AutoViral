import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface WorkSummary {
  id: string;
  title: string;
  type: "short-video" | "image-text";
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

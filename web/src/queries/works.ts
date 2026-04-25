import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface WorkSummary {
  id: string;
  title: string;
  type: "short-video" | "image-text";
  status: "draft" | "published" | "archived";
  thumbnail: string | null;
  updatedAt: string;
}

export interface CreateWorkInput {
  title: string;
  type: WorkSummary["type"];
}

export const worksKey = ["works"] as const;

export function useWorks() {
  return useQuery({
    queryKey: worksKey,
    queryFn: () => apiFetch<WorkSummary[]>("/api/works"),
  });
}

export function useCreateWork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkInput) => apiFetch<WorkSummary>("/api/works", { method: "POST", body: input }),
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

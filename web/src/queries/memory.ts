import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface MemoryProfile { tags: string[] }

export function useMemoryProfile() {
  return useQuery({
    queryKey: ["memory", "profile"],
    queryFn: () => apiFetch<MemoryProfile>("/api/memory/profile"),
    staleTime: 5 * 60_000,
  });
}

import { apiFetch } from "@/lib/api";

export async function exportMp4(
  workId: string,
): Promise<{ ok: boolean; output: string }> {
  return apiFetch(`/api/works/${workId}/render`, { method: "POST" });
}

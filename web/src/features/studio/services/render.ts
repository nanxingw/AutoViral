import { apiFetch } from "@/lib/api";

export interface EnqueueRenderOptions {
  type: "full" | "proxy";
  presetId?: string;
  burnSubtitles?: boolean;
  loudnessTargetLufs?: number;
}

export async function enqueueRender(
  workId: string,
  opts: EnqueueRenderOptions,
): Promise<{ jobId: string }> {
  return apiFetch(`/api/works/${workId}/render`, {
    method: "POST",
    body: opts,
  });
}

export async function cancelRender(jobId: string): Promise<void> {
  await apiFetch(`/api/render/jobs/${jobId}`, { method: "DELETE" });
}

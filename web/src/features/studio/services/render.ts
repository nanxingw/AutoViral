import { apiFetch } from "@/lib/api";

export interface EnqueueRenderOptions {
  type: "full" | "proxy";
  presetId?: string;
  burnSubtitles?: boolean;
  loudnessTargetLufs?: number;
  /** Phase H (issue #35) — Resolve-model per-text-track caption strategy.
   *  When supplied, takes precedence over `burnSubtitles` (which only chose
   *  the first text track). */
  captionTracks?: {
    burnTrackId?: string | null;
    sidecarTrackIds?: string[];
  };
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

/**
 * R43 — reveal a render output in the OS file browser (Finder /
 * Explorer / xdg-open). Server-side runs `open -R <path>` on macOS,
 * `explorer /select,<path>` on Windows, `xdg-open <dir>` on Linux.
 * Throws with errorCode 'reveal_unsupported_platform' if running on
 * something else (callers should hide the button rather than show the
 * raw error).
 */
export async function revealRenderOutput(
  workId: string,
  filename: string,
): Promise<void> {
  await apiFetch(`/api/render/reveal`, {
    method: "POST",
    body: { workId, filename },
  });
}

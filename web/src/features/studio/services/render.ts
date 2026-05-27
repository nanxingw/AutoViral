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

/** Minimal shape of the active export preset we bridge into render opts.
 *  Mirrors the relevant fields of composition.ExportPreset (#80). */
export interface RenderPresetSource {
  id?: string;
  loudnessTargetLufs?: number;
}

/**
 * #80 — bridge the stored platform preset's loudness target (and preset id)
 * into the render request.
 *
 * The server's loudnorm pipeline reads `body.loudnessTargetLufs` and otherwise
 * falls back to -14 (render-pipeline.ts). The preset is persisted in
 * `comp.exportPresets[0]` but the export call only ever sent `{type,...}`, so
 * any non-default target (e.g. WeChat Channels -16) was silently dropped and
 * every export normalised to -14. This forwards it explicitly.
 *
 * Values already present on `opts` win, so a future explicit caller can still
 * override the preset. A missing preset / field leaves the key `undefined`,
 * preserving the server's -14 default (no regression for the 7 presets that
 * are already -14).
 */
export function resolveRenderOpts(
  opts: EnqueueRenderOptions,
  preset: RenderPresetSource | undefined,
): EnqueueRenderOptions {
  return {
    ...opts,
    presetId: opts.presetId ?? preset?.id,
    loudnessTargetLufs: opts.loudnessTargetLufs ?? preset?.loudnessTargetLufs,
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

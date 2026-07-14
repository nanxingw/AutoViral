// S6b (PRD-0014) — the UI's "add a video to the timeline" convergence onto the
// SAME server-side `importClip` verb the agent's `autoviral clip import <path>`
// CLI runs (bridge POST /api/bridge/v1/import). The server ffprobe is the SOLE
// duration source — the client never invents a placeholder length. On success
// the bridge broadcasts `composition-changed`, which the Studio refetches
// (useBridgeEvents), so the imported clip appears WITHOUT a local store write.
//
// This mirrors sceneEdit.ts's apiFetch usage: it AWAITS + PROPAGATES failures
// (a probe that can't read a duration is a 400 the caller must surface), rather
// than the fire-and-forget focus ping. Callers toast the failure via
// `notifyImportFailed` so a corrupt/duration-less file never lands as a poison
// clip silently.

import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/stores/toast";
import { MESSAGES } from "@/i18n/messages";
import { useLocaleStore } from "@/i18n/store";

const BRIDGE_HEADERS = (workId: string) => ({
  "Content-Type": "application/json",
  "X-AutoViral-Work-Id": workId,
});

export interface ImportClipRemoteParams {
  /** Work-relative path (e.g. `output/final.mp4`). */
  path: string;
  /** Target video lane. Omit → the server picks the first video track. */
  trackId?: string;
  /** Explicit trackOffset in seconds (drag-drop landing point). Omit → append. */
  atSec?: number;
  /** Wipe every video lane first, then place this single clip at 0. */
  replaceTimeline?: boolean;
  /** Human-facing asset name. */
  name?: string;
}

export interface ImportClipRemoteResult {
  clipId: string;
  assetId: string;
  durationSec: number;
}

/**
 * POST the bridge `/import` verb. Returns the minted `{ clipId, assetId,
 * durationSec }` the server echoes (the probe duration). Rejects (does not
 * swallow) on a bridge failure — a failed ffprobe is a 400 the caller surfaces.
 *
 * The route's optional-field name for the offset is `at` (mapped to the op's
 * `atSec`); we translate `atSec` → `at` here so the studio speaks in seconds.
 */
export async function importClipRemote(
  workId: string,
  params: ImportClipRemoteParams,
): Promise<ImportClipRemoteResult> {
  const body: Record<string, unknown> = { path: params.path };
  if (params.trackId != null) body.trackId = params.trackId;
  if (params.atSec != null) body.at = params.atSec;
  if (params.replaceTimeline) body.replaceTimeline = true;
  if (params.name != null) body.name = params.name;

  const res = await apiFetch<{ ok: boolean; result?: ImportClipRemoteResult }>(
    "/api/bridge/v1/import",
    {
      method: "POST",
      headers: BRIDGE_HEADERS(workId),
      body,
    },
  );
  // The bridge always echoes `result` on a 2xx; the `!` mirrors addSceneRemote.
  return res.result!;
}

/**
 * Surface an import failure (probe failed / traversal / no video track) as a
 * user-visible error toast, localized. Every add-to-timeline call surface
 * (library ＋ button, preview modal, timeline drop) funnels its catch here so a
 * corrupt take never silently no-ops.
 */
export function notifyImportFailed(err: unknown): void {
  const locale = useLocaleStore.getState().locale;
  useToastStore.getState().push({
    variant: "error",
    message: MESSAGES[locale].studio.toast.importFailed,
    detail: err instanceof Error ? err.message : String(err),
    ttlMs: 5000,
  });
}

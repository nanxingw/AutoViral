// S4 (PRD-0007) — scene (分镜 / storyboard) EDIT writes from the Studio panel.
//
// THE INVARIANT THIS FILE GUARDS: every scene edit a human makes on a card goes
// through the SAME per-intent bridge route an agent's `autoviral scene …` CLI
// uses (PATCH /api/bridge/v1/scene/:id, POST /api/bridge/v1/scene/reorder), NOT
// through the Studio store's 800ms whole-composition autosave (pages/Studio.tsx).
//
// Why this matters (ADR-009 agent-人一致): `comp.scenes` in the store is a
// READ-ONLY mirror of what's on disk — it is only ever refreshed by the
// `composition-changed` → refetch path (useBridgeEvents). We NEVER mutate scenes
// in the store locally. So when the unrelated 800ms autosave fires its whole
// `PUT /comp`, it always carries server-fresh scenes and can never clobber a
// concurrent agent (or another tab's) scene write with a stale local copy.
//
// These mirror focus.ts's `apiFetch` usage. The ONE difference: focus.ts is
// fire-and-forget (`.catch(() => {})`) because a dropped focus ping is
// invisible; a scene EDIT that silently fails would lose the user's text, so
// these AWAIT and PROPAGATE the error to the caller (the card toasts it).

import { apiFetch } from "@/lib/api";
import type { Scene } from "@shared/composition";

const BRIDGE_HEADERS = (workId: string) => ({
  "Content-Type": "application/json",
  "X-AutoViral-Work-Id": workId,
});

// The fields a card may patch. Mirrors the bridge's setSceneProps allowlist
// (title/intent/prompt/narration/durationSec/shotSize/cameraMovement/mdAnchor).
// `order`/`id`/`status`/asset-state are owned by other ops and excluded.
//
// CLEAR PROTOCOL: an OPTIONAL field set to `null` clears it (the bridge op
// deletes the key). `undefined`/absent leaves it unchanged. `null` (not
// `undefined`) is required because `JSON.stringify` drops undefined keys — so an
// "unset" must travel as an explicit null to reach the server. `title` is
// required and therefore not clearable.
export type ScenePropsPatch = {
  title?: string;
  intent?: Scene["intent"] | null;
  prompt?: string | null;
  narration?: string | null;
  durationSec?: number | null;
  shotSize?: Scene["shotSize"] | null;
  cameraMovement?: Scene["cameraMovement"] | null;
  mdAnchor?: string | null;
};

/**
 * PATCH a single scene's editable props via the bridge — the SAME route the
 * agent's CLI hits. The body IS the props object (mirrors the bridge contract:
 * `PATCH /scene/:id { ...props }`). Only the changed fields should be passed.
 *
 * Rejects (does not swallow) on failure so the card can surface the error and
 * keep the user's unsaved text. Success needs no local setState — the bridge
 * broadcasts `composition-changed`, which refetches the composition into the
 * store (useBridgeEvents), re-rendering the card from server-fresh data.
 */
export function patchScene(
  workId: string,
  sceneId: string,
  props: ScenePropsPatch,
): Promise<unknown> {
  return apiFetch(`/api/bridge/v1/scene/${sceneId}`, {
    method: "PATCH",
    headers: BRIDGE_HEADERS(workId),
    body: props,
  });
}

/**
 * S7 (PRD-0007) — generate (or RESHOOT) a scene's image via the bridge, the
 * SAME route the agent's `autoviral scene generate <id>` CLI hits (POST
 * /scene/:id/generate). The server builds the generation prompt from the
 * scene's OWN fields (prompt/title + shotSize/cameraMovement/narration context)
 * — we send an empty body, never a prompt. On success the bridge registers the
 * new AssetEntry, links it onto the scene (appends a take, moves selectedAssetId
 * to the newest, flips status→generated) and broadcasts `composition-changed`,
 * which refetches the composition into the store → the card re-renders with the
 * thumbnail. A reshoot is just calling this again (the link op appends).
 *
 * Mirrors patchScene (lines 58-68): awaits + propagates so the card can show a
 * busy state and surface a failure, instead of silently dropping the request.
 */
export function generateScene(
  workId: string,
  sceneId: string,
): Promise<unknown> {
  return apiFetch(`/api/bridge/v1/scene/${sceneId}/generate`, {
    method: "POST",
    headers: BRIDGE_HEADERS(workId),
    body: {},
  });
}

/**
 * T1 (PRD-0008) — APPEND a new 分镜 via the bridge, the SAME route the agent's
 * `autoviral scene add --title …` CLI hits (POST /scene). The body carries the
 * required `title` (the op mints the `scn_` id + auto-assigns `order`); the
 * server echoes the minted sceneId in its `{ ok, result: { sceneId } }` envelope
 * so the caller can immediately expand/focus the brand-new card (T3). On success
 * the bridge broadcasts `composition-changed`, which refetches the composition
 * into the store → the list re-renders with the new card from server-fresh data.
 *
 * Mirrors patchScene (lines 58-68): awaits + propagates so the caller can surface
 * a failure (e.g. an empty title → 400) instead of silently dropping the add.
 * Unlike patchScene it READS the envelope's `result.sceneId` — the one bridge
 * scene verb that returns data (matching `GenerateCaptionsButton`'s `res.result`
 * read; `apiFetch` returns the WHOLE `{ ok, result }` envelope, never unwrapping).
 */
export async function addSceneRemote(
  workId: string,
  init: { title: string },
): Promise<string> {
  const res = await apiFetch<{ ok: boolean; result?: { sceneId?: string } }>(
    `/api/bridge/v1/scene`,
    {
      method: "POST",
      headers: BRIDGE_HEADERS(workId),
      body: { title: init.title },
    },
  );
  return res.result?.sceneId ?? "";
}

/**
 * T1 (PRD-0008) — REMOVE a 分镜 via the bridge, the SAME route the agent's
 * `autoviral scene remove <id>` CLI hits (DELETE /scene/:id). The id travels in
 * the path, so there is no body. `ops.removeScene` splices the scene out +
 * recompacts `order` to contiguous 0..N-1. On success the bridge broadcasts
 * `composition-changed`, which refetches the composition → the card disappears.
 *
 * Mirrors patchScene (lines 58-68): awaits + propagates so the caller can surface
 * a failure (e.g. an unknown id → 400) instead of silently dropping the delete.
 */
export function removeSceneRemote(
  workId: string,
  sceneId: string,
): Promise<unknown> {
  return apiFetch(`/api/bridge/v1/scene/${sceneId}`, {
    method: "DELETE",
    headers: BRIDGE_HEADERS(workId),
  });
}

/**
 * Reorder scenes to the EXACT `orderedSceneIds` sequence via the bridge. The op
 * requires a complete permutation of existing scene ids and recompacts `order`
 * to contiguous 0..N-1 server-side, so we always send the full expected order.
 */
export function reorderScenesRemote(
  workId: string,
  orderedSceneIds: string[],
): Promise<unknown> {
  return apiFetch(`/api/bridge/v1/scene/reorder`, {
    method: "POST",
    headers: BRIDGE_HEADERS(workId),
    body: { orderedSceneIds },
  });
}

/**
 * PURE — compute the new ordered scene-id sequence after moving the item at
 * `fromIndex` to `toIndex`. Returns the SAME array reference (no-op) when the
 * move is a no-op or out of bounds, so callers can skip the network write.
 *
 * This is the single source of truth for both the move-up/down buttons (the
 * accessible + testable path) and the drag handler — they both reduce a gesture
 * to (fromIndex, toIndex) and call this. The result is fed verbatim to
 * `reorderScenesRemote`, which the bridge validates as a permutation.
 */
export function moveInOrder<T>(ids: readonly T[], fromIndex: number, toIndex: number): T[] {
  const n = ids.length;
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= n ||
    toIndex < 0 ||
    toIndex >= n
  ) {
    return ids as T[];
  }
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

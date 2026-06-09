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

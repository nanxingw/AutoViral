import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AssetItem } from "@/queries/assets";
import type { Clip, Composition } from "../../types";

// I18 (PRD-0003 §3.2) — delete a library asset's file from disk via the new
// per-work endpoint DELETE /api/works/:id/assets/<path>. The endpoint mirrors
// the shared-assets delete guard (SAFE_ID workId + traversal-rejecting path
// resolution). On success the work's asset list is invalidated so the tile
// disappears; the caller is also responsible for the composition-side cleanup
// (store.removeAsset + removing clips that referenced it) so the timeline never
// silently points at a now-missing file.

export interface DeleteAssetResult {
  deleted: boolean;
  path: string;
}

/**
 * Builds the DELETE URL for a library asset. `asset.path` is the work-relative
 * path (e.g. "assets/clips/a.mp4" or "output/final.mp4"); each segment is
 * encoded the same way the asset's serve URL is so the round-trip matches.
 */
export function deleteAssetUrl(workId: string, asset: AssetItem): string {
  const encoded = asset.path.split("/").map(encodeURIComponent).join("/");
  return `/api/works/${workId}/assets/${encoded}`;
}

/**
 * Deletes a library asset's file. Uses apiFetch (JSON, throws ApiError on
 * non-2xx) so the caller's localizeApiError maps `asset_not_found` → message.
 * On success it invalidates the work's asset query so the tile disappears.
 */
export function useDeleteAsset(workId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (asset: AssetItem): Promise<DeleteAssetResult> => {
      return apiFetch<DeleteAssetResult>(deleteAssetUrl(workId, asset), {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["assets", workId] });
    },
  });
}

// ── referenced-asset handling (PRD-0003 §3.2 Open Q) ────────────────────────
//
// Policy: WARN-then-CASCADE. Deleting an asset that one or more timeline clips
// reference is not silently allowed (that would leave clips pointing at a file
// that no longer exists → broken timeline / black frames). Instead the UI warns
// the user how many clips reference it; confirming removes those clips AND the
// asset file. We never silently break the timeline (invariant #3 — the store
// write stays the SSoT and re-validates via zod).

/**
 * Reduce any of composition.yaml's asset-reference flavours to a single
 * canonical work-relative tail so they compare equal regardless of how they
 * were stored. resolveAssetUrl is NOT enough on its own: a workspace-relative
 * "assets/clips/a.mp4" resolves to the single-prefix "/api/works/<id>/assets/
 * clips/a.mp4", but a clip whose src was set from the asset's `url`
 * ("/api/works/<id>/assets/assets/clips/a.mp4" — queries/assets.ts double-
 * prefixes "assets/") is passed through verbatim, so the two never match. We
 * normalise by stripping the served prefix AND one leading "assets/", then
 * decoding, leaving the bare file path ("clips/a.mp4" / "output/final.mp4").
 * Scheme URLs (http/data/blob) and shared-assets paths reduce to themselves and
 * so never collide with a per-work library asset.
 */
function canonAssetKey(ref: string, workId: string): string {
  if (!ref) return ref;
  let p = ref;
  const apiPrefix = `/api/works/${workId}/assets/`;
  if (p.startsWith(apiPrefix)) p = p.slice(apiPrefix.length);
  if (p.startsWith("assets/")) p = p.slice("assets/".length);
  return p
    .split("/")
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join("/");
}

/**
 * Pure: the ids of every clip whose source references the same on-disk file as
 * `asset`. Both sides go through {@link canonAssetKey} so a clip stored as a
 * workspace-relative path ("assets/clips/a.mp4"), a single-prefix served URL,
 * or the double-prefixed asset `url` all match. Text clips have no source and
 * never match.
 */
export function findClipsReferencingAsset(
  comp: Composition,
  asset: AssetItem,
): string[] {
  const target = canonAssetKey(asset.path, comp.workId);
  const ids: string[] = [];
  for (const track of comp.tracks) {
    for (const clip of track.clips as Clip[]) {
      const src = (clip as { src?: string }).src;
      if (typeof src !== "string") continue;
      if (canonAssetKey(src, comp.workId) === target) ids.push(clip.id);
    }
  }
  return ids;
}

/**
 * Pure: the ids of the composition's provenance `assets[]` entries whose `uri`
 * references the same on-disk file as `asset`. Used to prune the provenance
 * graph alongside the on-disk file so a deleted asset leaves no dangling node.
 * Canonicalises both sides like {@link findClipsReferencingAsset}.
 */
export function findProvenanceAssetIds(
  comp: Composition,
  asset: AssetItem,
): string[] {
  const target = canonAssetKey(asset.path, comp.workId);
  return comp.assets
    .filter((a) => canonAssetKey(a.uri, comp.workId) === target)
    .map((a) => a.id);
}

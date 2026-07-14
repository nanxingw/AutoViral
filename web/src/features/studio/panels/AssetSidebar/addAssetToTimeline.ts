import { useCallback } from "react";
import { clipEnd } from "@autoviral/timeline";
import type { AssetItem } from "@/queries/assets";
import { useComposition } from "../../store";
import type { Clip, Track } from "../../types";
import { importClipRemote, notifyImportFailed } from "./importClip";

// #78 — wire the orphaned `addClip` store action to a UI trigger so users can
// place library assets onto the timeline.
//
// S6b (PRD-0014) — VIDEO placement no longer builds a local fixed-length
// placeholder clip. A video is imported through the shared server-side
// `importClip` verb (bridge POST /import → ffprobe → Asset/Provenance
// registration), the SAME verb `autoviral clip import` runs — so the clip's
// duration is a REAL probe value and the asset/provenance graph is registered,
// exactly matching the CLI. The clip appears via the `composition-changed` WS
// broadcast (useBridgeEvents), NOT a local store write.
//
// audio/image STAY on the local store path: `importClip` is video-only, and a
// probe of audio/image doesn't buy a timeline duration the way a video does.
// DEFAULT_ASSET_CLIP_DUR is their editable placeholder length (the user trims
// with the existing edge-drag resize).
export const DEFAULT_ASSET_CLIP_DUR = 5; // seconds

const ADDABLE_KINDS = new Set<AssetItem["kind"]>(["video", "audio", "image"]);

/** Only video/audio/image map to a timeline clip; text files / other do not. */
export function isAddableAsset(asset: AssetItem): boolean {
  return ADDABLE_KINDS.has(asset.kind);
}

/** The track kind an asset lands on. null for non-placeable kinds. */
function targetTrackKind(asset: AssetItem): Track["kind"] | null {
  switch (asset.kind) {
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "image":
      return "overlay";
    default:
      return null;
  }
}

/**
 * Pure: build a LOCAL {@link Clip} from a library asset at a given append
 * offset. audio → audio clip, image → overlay clip. **video returns null** —
 * S6b routes video through the server-side importClip verb (see the hook /
 * Track drop), so there is no local video clip to build. text / other → null.
 * `src` is the asset's work-relative path — the renderer resolves it to a URL.
 */
export function buildClipFromAsset(
  asset: AssetItem,
  trackOffset: number,
): Clip | null {
  const id = crypto.randomUUID();
  switch (asset.kind) {
    case "audio":
      return {
        id,
        kind: "audio",
        src: asset.path,
        in: 0,
        out: DEFAULT_ASSET_CLIP_DUR,
        trackOffset,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        type: "bgm",
      };
    case "image":
      return {
        id,
        kind: "overlay",
        src: asset.path,
        trackOffset,
        duration: DEFAULT_ASSET_CLIP_DUR,
        // Full-frame by default — a sensible "place this image" starting point
        // (the user can shrink it into a PiP via the inspector later).
        position: { xPct: 0, yPct: 0, wPct: 100, hPct: 100 },
        opacity: 1,
      };
    // video → null: the server importClip verb owns video placement (S6b).
    default:
      return null;
  }
}

/** The result of an add-to-timeline gesture — the three call surfaces (library
 *  ＋ button, preview modal, timeline drop) all consume this uniform shape. */
export type AddAssetResult =
  | { status: "added"; clipId: string; durationSec?: number }
  | { status: "skipped" }
  | { status: "error"; message: string };

/**
 * Hook returning `addAssetToTimeline(asset, opts?)`. VIDEO → async bridge import
 * (server ffprobe owns the duration; the clip arrives via the WS refresh).
 * audio/image → append a local clip to the matching-kind track, selecting it
 * (images target an overlay track, created on demand). `opts` lets a drop pass
 * an explicit destination `trackId` + landing `atSec`; omitted → append at the
 * end of the matching-kind lane.
 *
 * Returns `{status:"added", ...}` on success, `{status:"skipped"}` for a
 * non-placeable asset / no comp, `{status:"error"}` when an import fails (a
 * user-visible toast is already raised).
 */
export function useAddAssetToTimeline() {
  return useCallback(
    async (
      asset: AssetItem,
      opts?: { trackId?: string; atSec?: number },
    ): Promise<AddAssetResult> => {
      const store = useComposition.getState();
      if (!store.comp) return { status: "skipped" };

      // ── VIDEO: shared server-side importClip verb ──────────────────────────
      if (asset.kind === "video") {
        try {
          const res = await importClipRemote(store.comp.workId, {
            path: asset.path,
            trackId: opts?.trackId,
            atSec: opts?.atSec,
          });
          return { status: "added", clipId: res.clipId, durationSec: res.durationSec };
        } catch (err) {
          notifyImportFailed(err);
          return {
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // ── audio / image: local store placement (unchanged) ───────────────────
      const kind = targetTrackKind(asset);
      if (!kind) return { status: "skipped" };

      // Resolve the destination track. audio always exists in the default lane
      // set; overlay (images) is created on demand.
      let trackId: string;
      if (opts?.trackId) {
        trackId = opts.trackId;
      } else {
        const existingTrack = store.comp.tracks.find((t) => t.kind === kind);
        if (existingTrack) {
          trackId = existingTrack.id;
        } else if (kind === "overlay") {
          trackId = store.addTrack("overlay");
        } else {
          return { status: "skipped" };
        }
      }

      // Landing offset: an explicit drop `atSec`, else append at the end of the
      // destination track (re-read fresh state in case addTrack just mutated it).
      const dest = useComposition
        .getState()
        .comp!.tracks.find((t) => t.id === trackId)!;
      const clips = dest.clips as Clip[];
      const offset =
        opts?.atSec != null
          ? opts.atSec
          : clips.length
            ? Math.max(...clips.map(clipEnd))
            : 0;

      const clip = buildClipFromAsset(asset, offset);
      if (!clip) return { status: "skipped" };
      store.addClip(trackId, clip);
      store.setSelection(clip.id);
      return { status: "added", clipId: clip.id };
    },
    [],
  );
}

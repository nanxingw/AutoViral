import { useCallback } from "react";
import { clipEnd } from "@autoviral/timeline";
import type { AssetItem } from "@/queries/assets";
import { useComposition } from "../../store";
import type { Clip, Track } from "../../types";

// #78 — wire the orphaned `addClip` store action to a UI trigger so users can
// place library assets onto the timeline (previously clips could only be put
// there by the agent). Placement appends a default-length clip at the end of
// the matching-kind track; the user then trims it with the existing edge-drag
// resize. A real media-duration probe is out of scope (async, needs a hidden
// media element) — DEFAULT_ASSET_CLIP_DUR is the editable placeholder length.
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
 * Pure: build a {@link Clip} from a library asset at a given append offset.
 * Returns null for kinds with no timeline representation. `src` is the asset's
 * work-relative path — the renderer resolves it to a URL via resolveAssetUrl.
 */
export function buildClipFromAsset(
  asset: AssetItem,
  trackOffset: number,
): Clip | null {
  const id = crypto.randomUUID();
  switch (asset.kind) {
    case "video":
      return {
        id,
        kind: "video",
        src: asset.path,
        in: 0,
        out: DEFAULT_ASSET_CLIP_DUR,
        trackOffset,
        // S16 — default fit-fill mode (crop-to-fill, the legacy behaviour).
        fitMode: "cover",
        transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
        filters: { brightness: 0, contrast: 0, saturation: 0 },
      };
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
    default:
      return null;
  }
}

/**
 * Hook returning `addAssetToTimeline(asset)`: appends a clip built from the
 * asset to the end of the matching-kind track, selecting it. Images target an
 * overlay track, creating one on demand since the default lane set has none.
 * Returns the new clip id, or null if the asset isn't placeable / no comp.
 */
export function useAddAssetToTimeline() {
  return useCallback((asset: AssetItem): string | null => {
    const kind = targetTrackKind(asset);
    if (!kind) return null;
    const store = useComposition.getState();
    if (!store.comp) return null;

    // Resolve the destination track. video/audio always exist in the default
    // lane set; overlay (images) is created on demand.
    let trackId: string;
    const existingTrack = store.comp.tracks.find((t) => t.kind === kind);
    if (existingTrack) {
      trackId = existingTrack.id;
    } else if (kind === "overlay") {
      trackId = store.addTrack("overlay");
    } else {
      return null;
    }

    // Append at the end of the destination track (re-read fresh state in case
    // addTrack just mutated it).
    const dest = useComposition
      .getState()
      .comp!.tracks.find((t) => t.id === trackId)!;
    const clips = dest.clips as Clip[];
    const offset = clips.length ? Math.max(...clips.map(clipEnd)) : 0;

    const clip = buildClipFromAsset(asset, offset);
    if (!clip) return null;
    store.addClip(trackId, clip);
    store.setSelection(clip.id);
    return clip.id;
  }, []);
}

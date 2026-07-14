import { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import type { Composition } from "../types";
import { VideoTrackRenderer } from "./tracks/VideoTrackRenderer";
import { AudioTrackRenderer } from "./tracks/AudioTrackRenderer";
import { TextTrackRenderer } from "./tracks/TextTrackRenderer";
import { OverlayTrackRenderer } from "./tracks/OverlayTrackRenderer";
import { AdjustmentTrackRenderer } from "./tracks/AdjustmentTrackRenderer";
import { resolveCompositionAssets } from "./resolveAssetUrl";
import { CaptionsLayer } from "./captions/CaptionsLayer";

export function Scene({ comp }: { comp: Composition }) {
  // Rewrite relative `assets/...` clip srcs to /api/works/:id/assets/...
  // so browser-side <Video>/<Audio>/<Img> elements load via the dev
  // server's proxy. Composition.yaml on disk stays portable. Render-side
  // applies the equivalent rewrite in render-pipeline.ts.
  const resolved = useMemo(() => resolveCompositionAssets(comp), [comp]);
  // S14 (PRD-0014, review fix #6) — paint tracks in `displayOrder`, NOT raw array
  // order. z-order is what the user sees + what an adjustment lane's
  // `backdrop-filter` grades (it affects every track painted BELOW it). The UI
  // track list drag-reorder writes `displayOrder` (store.reorderTracks) WITHOUT
  // reordering the array, so painting in array order made a moved adjustment lane
  // grade the wrong tracks — preview z-order diverged from the UI layer stack.
  // Sorting here realigns them. Stable for pre-existing works (array order already
  // equals displayOrder on load). Later array index breaks ties for legacy comps
  // that share a displayOrder.
  const paintTracks = useMemo(
    () =>
      resolved.tracks
        .map((t, i) => ({ t, i }))
        .sort((a, b) => a.t.displayOrder - b.t.displayOrder || a.i - b.i)
        .map(({ t }) => t),
    [resolved.tracks],
  );
  // R46 #4 — overlay-strategy captions. When captionStrategy="overlay"
  // and a CaptionModel is attached, mount CaptionsLayer on top of all
  // tracks. The render pipeline detects the same conditions and skips
  // Stage 3 (libass burn) so we don't double-render captions.
  const showCaptionOverlay =
    comp.captionStrategy === "overlay" && comp.captions != null;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {paintTracks.map((t) => {
        if (t.kind === "video")
          return <VideoTrackRenderer key={t.id} track={t} />;
        if (t.kind === "audio")
          return <AudioTrackRenderer key={t.id} track={t} />;
        if (t.kind === "text")
          return <TextTrackRenderer key={t.id} track={t} />;
        if (t.kind === "adjustment")
          return <AdjustmentTrackRenderer key={t.id} track={t} />;
        return <OverlayTrackRenderer key={t.id} track={t} />;
      })}
      {showCaptionOverlay ? (
        <CaptionsLayer model={comp.captions!} />
      ) : null}
    </AbsoluteFill>
  );
}

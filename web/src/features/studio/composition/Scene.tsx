import { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import type { Composition } from "../types";
import { VideoTrackRenderer } from "./tracks/VideoTrackRenderer";
import { AudioTrackRenderer } from "./tracks/AudioTrackRenderer";
import { TextTrackRenderer } from "./tracks/TextTrackRenderer";
import { OverlayTrackRenderer } from "./tracks/OverlayTrackRenderer";
import { resolveCompositionAssets } from "./resolveAssetUrl";
import { CaptionsLayer } from "./captions/CaptionsLayer";

export function Scene({ comp }: { comp: Composition }) {
  // Rewrite relative `assets/...` clip srcs to /api/works/:id/assets/...
  // so browser-side <Video>/<Audio>/<Img> elements load via the dev
  // server's proxy. Composition.yaml on disk stays portable. Render-side
  // applies the equivalent rewrite in render-pipeline.ts.
  const resolved = useMemo(() => resolveCompositionAssets(comp), [comp]);
  // R46 #4 — overlay-strategy captions. When captionStrategy="overlay"
  // and a CaptionModel is attached, mount CaptionsLayer on top of all
  // tracks. The render pipeline detects the same conditions and skips
  // Stage 3 (libass burn) so we don't double-render captions.
  const showCaptionOverlay =
    comp.captionStrategy === "overlay" && comp.captions != null;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {resolved.tracks.map((t) => {
        if (t.kind === "video")
          return <VideoTrackRenderer key={t.id} track={t} />;
        if (t.kind === "audio")
          return <AudioTrackRenderer key={t.id} track={t} />;
        if (t.kind === "text")
          return <TextTrackRenderer key={t.id} track={t} />;
        return <OverlayTrackRenderer key={t.id} track={t} />;
      })}
      {showCaptionOverlay ? (
        <CaptionsLayer model={comp.captions!} />
      ) : null}
    </AbsoluteFill>
  );
}

import { AbsoluteFill } from "remotion";
import type { Composition } from "../types";
import { VideoTrackRenderer } from "./tracks/VideoTrackRenderer";
import { AudioTrackRenderer } from "./tracks/AudioTrackRenderer";
import { TextTrackRenderer } from "./tracks/TextTrackRenderer";
import { OverlayTrackRenderer } from "./tracks/OverlayTrackRenderer";

export function Scene({ comp }: { comp: Composition }) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {comp.tracks.map((t) => {
        if (t.kind === "video")
          return <VideoTrackRenderer key={t.id} track={t} />;
        if (t.kind === "audio")
          return <AudioTrackRenderer key={t.id} track={t} />;
        if (t.kind === "text")
          return <TextTrackRenderer key={t.id} track={t} />;
        return <OverlayTrackRenderer key={t.id} track={t} />;
      })}
    </AbsoluteFill>
  );
}

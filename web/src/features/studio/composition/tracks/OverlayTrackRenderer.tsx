import { Sequence, useVideoConfig, Img } from "remotion";
import type { OverlayClip, Track } from "../../types";

export function OverlayTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.hidden) return null;
  return (
    <>
      {(track.clips as OverlayClip[]).map((c) => (
        <Sequence
          key={c.id}
          from={Math.round(c.trackOffset * fps)}
          durationInFrames={Math.max(1, Math.round(c.duration * fps))}
        >
          <Img
            src={c.src}
            style={{
              position: "absolute",
              left: `${c.position.xPct}%`,
              top: `${c.position.yPct}%`,
              width: `${c.position.wPct}%`,
              height: `${c.position.hPct}%`,
              opacity: c.opacity,
            }}
          />
        </Sequence>
      ))}
    </>
  );
}

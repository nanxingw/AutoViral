import { Clip } from "./Clip";
import type { Track as TrackType } from "../../types";

export function Track({
  track,
  pxPerSecond,
}: {
  track: TrackType;
  pxPerSecond: number;
}) {
  return (
    <div
      className="timeline-track"
      data-kind={track.kind}
      style={{
        position: "relative",
        height: 56,
        borderTop: "1px solid var(--border)",
      }}
    >
      <div
        className="track-label"
        style={{
          position: "absolute",
          left: -120,
          width: 110,
          textAlign: "right",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--text-soft)",
        }}
      >
        {track.label}
      </div>
      {track.clips.map((c) => (
        <Clip key={c.id} clipId={c.id} pxPerSecond={pxPerSecond} />
      ))}
    </div>
  );
}

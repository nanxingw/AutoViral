import { Sequence, OffthreadVideo, useVideoConfig } from "remotion";
import type { VideoClip, Track } from "../../types";
import { toCssFilter } from "../filters/cssFilters";

export function VideoTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.hidden) return null;
  return (
    <>
      {(track.clips as VideoClip[]).map((c) => {
        const from = Math.round(c.trackOffset * fps);
        const dur = Math.max(1, Math.round((c.out - c.in) * fps));
        const filter = toCssFilter(c.filters);
        const t = c.transforms;
        return (
          <Sequence key={c.id} from={from} durationInFrames={dur}>
            <OffthreadVideo
              src={c.src}
              startFrom={Math.round(c.in * fps)}
              endAt={Math.round(c.out * fps)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: filter || undefined,
                transform: `translate(${t.x}px, ${t.y}px) rotate(${t.rotation}deg) scale(${t.scale})`,
              }}
            />
          </Sequence>
        );
      })}
    </>
  );
}

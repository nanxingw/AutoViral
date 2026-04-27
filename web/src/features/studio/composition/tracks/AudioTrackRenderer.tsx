import { Sequence, Audio, useVideoConfig } from "remotion";
import type { AudioClip, Track } from "../../types";

export function AudioTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.muted) return null;
  return (
    <>
      {(track.clips as AudioClip[]).map((c) => {
        const from = Math.round(c.trackOffset * fps);
        const dur = Math.max(1, Math.round((c.out - c.in) * fps));
        return (
          <Sequence key={c.id} from={from} durationInFrames={dur}>
            <Audio
              src={c.src}
              startFrom={Math.round(c.in * fps)}
              endAt={Math.round(c.out * fps)}
              volume={c.volume}
            />
          </Sequence>
        );
      })}
    </>
  );
}

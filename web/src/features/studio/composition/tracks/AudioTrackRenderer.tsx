import { Sequence, Audio, useVideoConfig, useCurrentFrame } from "remotion";
import type { AudioClip, Track } from "../../types";
import { interpolateProperty } from "@shared/keyframes";

/**
 * Pure helper for testability: returns the effective volume for an audio
 * clip at a given frame counted from the clip's local 0 (i.e. inside the
 * Sequence). Both fadeIn and fadeOut are linear ramps in clip-local seconds
 * applied on top of `base`.
 *
 * Phase 8.2.C — the previous signature took `clip.volume` as the implicit
 * base. We now accept `base` explicitly so the keyframe path
 * (`base = interpolateProperty(...) ?? clip.volume`) and the static path
 * share this fade math without `computeAudioVolumeForFrame` knowing about
 * keyframes itself.
 */
export function computeAudioVolumeForFrame(
  clip: { fadeIn: number; fadeOut: number; in: number; out: number },
  localFrame: number,
  fps: number,
  base: number,
): number {
  const localSec = localFrame / fps;
  const dur = clip.out - clip.in;
  const fadeIn = clip.fadeIn ?? 0;
  const fadeOut = clip.fadeOut ?? 0;
  let v = base;
  if (fadeIn > 0 && localSec < fadeIn) {
    v *= Math.max(0, Math.min(1, localSec / fadeIn));
  }
  if (fadeOut > 0 && localSec > dur - fadeOut) {
    const t = (dur - localSec) / fadeOut;
    v *= Math.max(0, Math.min(1, t));
  }
  return Math.max(0, v);
}

function AudioClipRenderer({
  clip,
}: {
  clip: AudioClip;
}) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const localSec = frame / fps;
  // D9: keyframe value when present, else fall back to the static clip.volume.
  // Fades (fadeIn/fadeOut) are independent affordances and ride on top.
  const base =
    interpolateProperty(clip.keyframes, "volume", localSec) ?? clip.volume;
  const v = computeAudioVolumeForFrame(clip, frame, fps, base);
  return (
    <Audio
      src={clip.src}
      startFrom={Math.round(clip.in * fps)}
      endAt={Math.round(clip.out * fps)}
      volume={v}
    />
  );
}

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
            <AudioClipRenderer clip={c} />
          </Sequence>
        );
      })}
    </>
  );
}

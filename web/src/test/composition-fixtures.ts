import type { Clip, Composition, Track, VideoClip, AudioClip, TextClip, OverlayClip } from "../features/studio/types";
import { makeEmptyComposition } from "../features/studio/types";

const baseTransform = { scale: 1, x: 0, y: 0, rotation: 0 };
const baseFilters = { brightness: 0, contrast: 0, saturation: 0 };

export function makeVideoClip(over: Partial<VideoClip> & Pick<VideoClip, "id">): VideoClip {
  return {
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 2,
    trackOffset: 0,
    transforms: baseTransform,
    filters: baseFilters,
    ...over,
  } as VideoClip;
}

export function makeAudioClip(over: Partial<AudioClip> & Pick<AudioClip, "id">): AudioClip {
  return {
    kind: "audio",
    src: "/a.mp3",
    in: 0,
    out: 4,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
    ...over,
  } as AudioClip;
}

export function makeTextClip(over: Partial<TextClip> & Pick<TextClip, "id">): TextClip {
  return {
    kind: "text",
    text: "hello",
    trackOffset: 0,
    duration: 2,
    style: { font: "Inter", size: 64, weight: 700, italic: false, tracking: 0, color: "#fff" },
    position: { anchor: "bottom", xPct: 50, yPct: 85 },
    ...over,
  } as TextClip;
}

export function makeOverlayClip(over: Partial<OverlayClip> & Pick<OverlayClip, "id">): OverlayClip {
  return {
    kind: "overlay",
    src: "/o.png",
    trackOffset: 0,
    duration: 2,
    position: { xPct: 50, yPct: 50, wPct: 20, hPct: 20 },
    opacity: 1,
    ...over,
  } as OverlayClip;
}

export function makeCompositionWithClips(clips: Clip[], opts: { workId?: string } = {}): Composition {
  const c = makeEmptyComposition({ workId: opts.workId ?? "w" });
  // First track in makeEmptyComposition is the video track.
  c.tracks[0].clips.push(...(clips as VideoClip[]));
  c.duration = Math.max(
    0,
    ...clips.map((cl) =>
      cl.kind === "video" || cl.kind === "audio"
        ? cl.trackOffset + (cl.out - cl.in)
        : cl.trackOffset + cl.duration,
    ),
  );
  return c;
}

export function threeClipVideoTrack(): { track: Track; clips: VideoClip[] } {
  const a = makeVideoClip({ id: "a", trackOffset: 0, in: 0, out: 2 });
  const b = makeVideoClip({ id: "b", trackOffset: 2, in: 0, out: 3 });
  const d = makeVideoClip({ id: "d", trackOffset: 5, in: 0, out: 1 });
  const track: Track = {
    id: "track-video",
    kind: "video",
    label: "Video",
    muted: false,
    hidden: false,
    clips: [a, b, d],
  };
  return { track, clips: [a, b, d] };
}

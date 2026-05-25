// Phase 4.E — WaveformBars.
//
// Pneuma upstream:
// .cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/WaveformBars.tsx
// (35 lines). Pneuma's component is purely presentational: takes
// `peaks: number[]`, `height`, `color` and renders a flex row of `<div>`
// bars. We adapt for this codebase's mounting site (under an audio clip
// inside Track.tsx) by:
//
//   - Wrapping the pneuma presentational shell with a small subscriber
//     that calls useWaveform(clip.src) — pneuma calls the hook in the
//     parent. Doing it here keeps Track.tsx small and matches how 4.D's
//     Filmstrip is structured.
//   - Rendering as a fixed-width SVG instead of pneuma's flex `<div>`s
//     when peaks are loaded. SVG keeps the bar widths uniform across
//     zoom changes without re-flow flicker on Track resize.
//   - Loading placeholder uses --accent-glow gradient to match the
//     codebase's editorial-cool palette.
import { useWaveform } from "../../hooks/useWaveform";
import { resolveAssetUrl } from "../../composition/resolveAssetUrl";
import { useComposition } from "../../store";
import type { AudioClip } from "../../types";

interface Props {
  clip: AudioClip;
  pxPerSecond: number;
  height: number;
}

export function WaveformBars({ clip, pxPerSecond, height }: Props) {
  // composition.yaml stores clip.src as a workspace-relative path
  // ("assets/audio/bed.mp3"). Passing that raw to fetch() resolves
  // against the current SPA route (/studio/<workId>/assets/...) and
  // Vite's history-fallback returns index.html with content-type
  // text/html — AudioContext.decodeAudioData then throws, peaks stays
  // null, and the track is stuck rendering the gradient placeholder
  // forever (the "no waveform" bug). Mirror Filmstrip's resolver so
  // audio + video tracks both pass through /api/works/:id/assets/*.
  const workId = useComposition((s) => s.comp?.workId ?? "");
  const resolvedSrc = workId ? resolveAssetUrl(clip.src, workId) : clip.src;
  const { peaks, sourceDuration } = useWaveform(resolvedSrc);
  const dur = Math.max(0, clip.out - clip.in);
  const width = dur * pxPerSecond;

  if (
    !peaks ||
    sourceDuration == null ||
    sourceDuration <= 0 ||
    width <= 0
  ) {
    return (
      <div
        aria-label="waveform-loading"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: Math.max(0, width),
          height,
          background:
            "linear-gradient(90deg, rgba(168,197,214,0.10), rgba(168,197,214,0.04))",
          borderRadius: 4,
        }}
      />
    );
  }

  // The hook returns 128 peaks spanning the entire decoded source audio.
  // Slice the window corresponding to [clip.in, clip.out] using the
  // source's true duration (NOT clip.in + dur, which collapses to
  // clip.out and yields a wrong region for any clip with in > 0).
  const startIdx = Math.max(
    0,
    Math.floor((clip.in / sourceDuration) * peaks.length),
  );
  const endIdx = Math.min(
    peaks.length,
    Math.ceil((clip.out / sourceDuration) * peaks.length),
  );
  const visible = peaks.slice(startIdx, Math.max(startIdx + 1, endIdx));
  const barCount = Math.max(1, visible.length);

  return (
    <svg
      aria-label="waveform"
      width={width}
      height={height}
      viewBox={`0 0 ${barCount} 100`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        pointerEvents: "none",
        opacity: 0.55,
      }}
    >
      {Array.from(visible).map((p, i) => {
        const h = Math.max(2, p * 100);
        return (
          <rect
            key={i}
            x={i}
            y={(100 - h) / 2}
            width={1}
            height={h}
            fill="var(--accent, #a8c5d6)"
          />
        );
      })}
    </svg>
  );
}

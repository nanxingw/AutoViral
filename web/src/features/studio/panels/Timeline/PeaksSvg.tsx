// A6 (PRD-0010) — PeaksSvg: the shared "peaks[] → svg bars" renderer.
//
// Extracted from WaveformBars so the timeline clip waveform and the AUDIO
// library row's mini waveform render through ONE code path (and read the same
// useWaveform peaks cache). Pure/presentational — no data fetching, no hooks.
//
// Markup contract (kept byte-compatible with the pre-extraction WaveformBars
// so the timeline is visually unchanged):
//   - <svg aria-label="waveform" viewBox="0 0 <barCount> 100"
//          preserveAspectRatio="none"> with one <rect> per peak;
//   - rect: x=i, width=1, height=max(2, peak*100), y=(100-height)/2;
//   - empty peaks (or width<=0) → a gradient loading skeleton
//     (aria-label="waveform-loading"), NOT an svg.
import type { CSSProperties } from "react";

interface Props {
  /** Normalized [0,1] bar heights. Float32Array (useWaveform) or number[]. */
  peaks: ArrayLike<number>;
  width: number;
  height: number;
  /** Bar fill. Defaults to the editorial-cool accent. */
  color?: string;
  /** Whole-svg opacity. Timeline overlays at 0.55; rows can go louder. */
  opacity?: number;
  /**
   * Timeline mounts the waveform as an absolute overlay under the clip;
   * the library row lays it out inline in a flex box. Toggle positioning
   * without duplicating the component.
   */
  absolute?: boolean;
}

export function PeaksSvg({
  peaks,
  width,
  height,
  color = "var(--accent, #a8c5d6)",
  opacity = 0.55,
  absolute = false,
}: Props) {
  const barCount = peaks.length;

  const positioning: CSSProperties = absolute
    ? { position: "absolute", left: 0, top: 0 }
    : {};

  // Loading skeleton — no peaks yet (or a degenerate width). Matches the prior
  // WaveformBars in-flight placeholder so the timeline decode window is
  // visually identical.
  if (barCount === 0 || width <= 0) {
    return (
      <div
        aria-label="waveform-loading"
        style={{
          ...positioning,
          width: Math.max(0, width),
          height,
          background:
            "linear-gradient(90deg, rgba(168,197,214,0.10), rgba(168,197,214,0.04))",
          borderRadius: 4,
        }}
      />
    );
  }

  return (
    <svg
      aria-label="waveform"
      width={width}
      height={height}
      viewBox={`0 0 ${barCount} 100`}
      preserveAspectRatio="none"
      style={{
        ...positioning,
        pointerEvents: "none",
        opacity,
      }}
    >
      {Array.from(peaks).map((p, i) => {
        const h = Math.max(2, p * 100);
        return (
          <rect
            key={i}
            x={i}
            y={(100 - h) / 2}
            width={1}
            height={h}
            fill={color}
          />
        );
      })}
    </svg>
  );
}

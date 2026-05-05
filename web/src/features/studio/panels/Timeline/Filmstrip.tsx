// Filmstrip — strip of thumbnail frames rendered behind a video clip.
//
// D8 cache strategy: we always cache frames at a fixed 0.5s grid (so zoom
// changes don't invalidate the module-scoped extractor cache); the rendered
// thumbnail step is zoom-aware via Math.max(0.5, 60/pxPerSecond) so each
// thumbnail is at least ~60px wide regardless of zoom.
import { useMemo } from "react";
import { useFrameExtractor } from "./hooks/useFrameExtractor";
import type { VideoClip } from "../../types";

const CACHE_INTERVAL = 0.5; // D8

interface Props {
  clip: VideoClip;
  pxPerSecond: number;
  height: number;
}

export function Filmstrip({ clip, pxPerSecond, height }: Props) {
  const dur = clip.out - clip.in;
  const renderStep = Math.max(CACHE_INTERVAL, 60 / Math.max(1, pxPerSecond));

  // Cache grid: every 0.5s within [in, out). Uses Number(toFixed(3)) so the
  // Map keys round-trip through extractOne's `t.toFixed(3)` cache key.
  const cacheTimestamps = useMemo(() => {
    const ts: number[] = [];
    for (let t = clip.in; t < clip.out; t += CACHE_INTERVAL) {
      ts.push(Number(t.toFixed(3)));
    }
    return ts;
  }, [clip.in, clip.out]);

  const { frames } = useFrameExtractor({
    src: clip.src,
    timestamps: cacheTimestamps,
  });

  // Render-time grid (zoom-aware). Each thumb is `renderStep * pxPerSecond` wide.
  const renderTimes = useMemo(() => {
    const ts: number[] = [];
    for (let t = clip.in; t < clip.out; t += renderStep) ts.push(t);
    return ts;
  }, [clip.in, clip.out, renderStep]);

  const thumbWidth = renderStep * pxPerSecond;
  const totalWidth = dur * pxPerSecond;

  return (
    <div
      aria-label="filmstrip"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: totalWidth,
        height,
        display: "flex",
        overflow: "hidden",
        pointerEvents: "none",
        opacity: 0.55,
        borderRadius: 4,
      }}
    >
      {renderTimes.map((t) => {
        // Snap each render-time to the nearest cached timestamp for lookup.
        let cacheT = cacheTimestamps[0] ?? 0;
        let bestDelta = Math.abs(cacheT - t);
        for (const c of cacheTimestamps) {
          const d = Math.abs(c - t);
          if (d < bestDelta) {
            bestDelta = d;
            cacheT = c;
          }
        }
        const url = frames.get(cacheT);
        return (
          <div
            key={t}
            data-filmstrip-thumb
            style={{
              width: thumbWidth,
              height,
              flexShrink: 0,
              background: url
                ? `center / cover no-repeat url(${url})`
                : "var(--surface-1, #1c1d22)",
              borderRight: "1px solid rgba(0,0,0,0.18)",
            }}
          />
        );
      })}
    </div>
  );
}

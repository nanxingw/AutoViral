// Filmstrip — strip of thumbnail frames rendered behind a video clip.
//
// D8 cache strategy: we always cache frames at a fixed 0.5s grid (so zoom
// changes don't invalidate the module-scoped extractor cache); the rendered
// thumbnail step is zoom-aware via Math.max(0.5, 60/pxPerSecond) so each
// thumbnail is at least ~60px wide regardless of zoom.
import { useMemo } from "react";
import { useFrameExtractor } from "./hooks/useFrameExtractor";
import { resolveAssetUrl } from "../../composition/resolveAssetUrl";
import { useComposition } from "../../store";
import type { VideoClip } from "../../types";

const CACHE_INTERVAL = 0.5; // D8

interface Props {
  clip: VideoClip;
  pxPerSecond: number;
  height: number;
}

export function Filmstrip({ clip, pxPerSecond, height }: Props) {
  // composition.yaml stores clip.src as a workspace-relative path. The
  // hidden <video> the extractor creates loads against the page origin
  // (vite dev) which doesn't proxy `/assets/*` — only `/api/*`. Rewrite
  // through the same helper Scene uses so the filmstrip and the preview
  // stay in sync.
  const workId = useComposition((s) => s.comp?.workId ?? "");
  const resolvedSrc = workId ? resolveAssetUrl(clip.src, workId) : clip.src;
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
    src: resolvedSrc,
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

  // Pre-snap each render-time to its nearest cached timestamp ONCE per zoom
  // change; without this, every progressive-paint repaint would rerun an
  // O(renderTimes × cacheTimestamps) loop inside the JSX .map.
  const renderToCache = useMemo(() => {
    const map = new Map<number, number>();
    if (cacheTimestamps.length === 0) return map;
    for (const t of renderTimes) {
      let best = cacheTimestamps[0];
      let bestDelta = Math.abs(best - t);
      for (const c of cacheTimestamps) {
        const d = Math.abs(c - t);
        if (d < bestDelta) {
          bestDelta = d;
          best = c;
        }
      }
      map.set(t, best);
    }
    return map;
  }, [renderTimes, cacheTimestamps]);

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
        const cacheT = renderToCache.get(t);
        const url = cacheT !== undefined ? frames.get(cacheT) : undefined;
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

// useFrameExtractor — port of pneuma's hidden-video + canvas frame grab.
//
// Source: .cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/hooks/useFrameExtractor.ts:1-159
// Adapted for AutoViral's call shape (per-timestamp Map keyed by t) so
// the Filmstrip consumer can sample at arbitrary zoom-aware steps. The
// pneuma original returns FrameData[]; we return Map<number,string> so
// `frames.get(t)` is O(1) at render time and matches D8's bucket-based cache.
//
// Behaviour preserved from pneuma:
//   - hidden <video crossOrigin="anonymous" preload="auto" muted playsInline>
//   - Math.max(t, 0.05) poster-frame avoidance (pneuma:107-108)
//   - readyState>=2 short-circuit + canplay/error listeners (pneuma:38-57)
//   - seekTo(time) wraps a Promise around the `seeked` event (pneuma:18-35)
//   - drawImage at video aspect ratio onto a canvas, toDataURL("image/jpeg",0.6)
//   - abort flag cleared on unmount; video.src="" + load() to drop network
//
// Module-scoped promise-dedupe cache (D8): two simultaneous renders for the
// same (src, t) share one extraction promise.

import { useEffect, useRef, useState } from "react";

const cache = new Map<string, Promise<string>>();

function key(src: string, t: number): string {
  return `${src}::${t.toFixed(3)}`;
}

/** Test-only — clears the module-scoped dedupe cache. */
export function __resetFrameCacheForTests(): void {
  cache.clear();
}

/** Wait for video to be ready for seeking (pneuma:38-57). */
function waitForVideo(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2) {
      resolve();
      return;
    }
    const onReady = () => {
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onErr);
      resolve();
    };
    const onErr = () => {
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onErr);
      reject(new Error("video load error"));
    };
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onErr);
  });
}

/** Seek to `time` and resolve once the `seeked` event fires (pneuma:18-35). */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
      resolve();
    };
    const onErr = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
      reject(new Error("video seek error"));
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onErr);
    video.currentTime = time;
  });
}

async function extractOne(src: string, t: number): Promise<string> {
  const safeT = Math.max(t, 0.05);
  const k = key(src, safeT);
  const cached = cache.get(k);
  if (cached) return cached;

  const promise = (async (): Promise<string> => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.style.display = "none";
    video.src = src;
    document.body.appendChild(video);

    try {
      await waitForVideo(video);
      await seekTo(video, safeT);
      const canvas = document.createElement("canvas");
      const aspect =
        (video.videoWidth || 16) / (video.videoHeight || 9) || 16 / 9;
      const h = 60;
      const w = Math.max(1, Math.round(h * aspect));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, w, h);
      }
      return canvas.toDataURL("image/jpeg", 0.6);
    } finally {
      // pneuma:152-154 — drop network references on cleanup.
      try {
        video.src = "";
        video.load();
      } catch {
        // happy-dom may throw on src=""; we only care about freeing the node.
      }
      video.remove();
    }
  })();

  cache.set(k, promise);
  // If the promise rejects, evict the cache entry so a retry is possible.
  promise.catch(() => {
    if (cache.get(k) === promise) cache.delete(k);
  });
  return promise;
}

export interface UseFrameExtractorArgs {
  src: string;
  timestamps: readonly number[];
}

export interface UseFrameExtractorResult {
  frames: Map<number, string>;
  loading: boolean;
}

export function useFrameExtractor({
  src,
  timestamps,
}: UseFrameExtractorArgs): UseFrameExtractorResult {
  const [frames, setFrames] = useState<Map<number, string>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  // Stable join of the timestamps array — JSON.stringify keeps numeric
  // precision and lets React's dep array short-circuit on identical arrays.
  const stamps = timestamps.join(",");

  useEffect(() => {
    aliveRef.current = true;

    if (!src || timestamps.length === 0) {
      setFrames(new Map());
      setLoading(false);
      return () => {
        aliveRef.current = false;
      };
    }

    setLoading(true);
    const next = new Map<number, string>();
    let pending = timestamps.length;

    timestamps.forEach((t) => {
      extractOne(src, t)
        .then((url) => {
          if (!aliveRef.current) return;
          next.set(t, url);
          // Progressive paint — pneuma:138 also incrementally updates state.
          setFrames(new Map(next));
        })
        .catch(() => {
          // swallow — extractOne already evicts the cache for retry.
        })
        .finally(() => {
          pending -= 1;
          if (pending <= 0 && aliveRef.current) setLoading(false);
        });
    });

    return () => {
      aliveRef.current = false;
    };
    // `stamps` covers the timestamps array shape; eslint disable to keep
    // the join() identity check rather than re-running on array reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, stamps]);

  return { frames, loading };
}

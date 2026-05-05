// Phase 4.E — useWaveform (custom Web-Audio decode + 128-bucket peaks).
//
// Replaces the prior wavesurfer.js wrapper. Follows pneuma upstream at
// .cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/hooks/useWaveform.ts
// (lines 28-89): fetch → arrayBuffer → AudioContext.decodeAudioData →
// channel.getChannelData(0) → per-bar max-abs scan → normalize.
//
// USER DECISION 3A — Pneuma fidelity with explicit local divergence (D9):
//   - Bucket count is a fixed 128 (D9), not a per-call `bars` option as in
//     pneuma. We render uniformly across all clips in this codebase.
//   - Cache is module-scoped `Map<string, Promise<Float32Array>>` keyed on
//     `src` only, so concurrent hooks for the same audio share the
//     in-flight decode (D9 promise dedupe). Pneuma uses a useRef map keyed
//     on `${url}:${bars}` and would re-fetch on remount; module scope is
//     the correct level for cache lifetime in this React tree.
//   - Returned shape is `{ peaks: number[] | null; loading: boolean }`
//     (drops `duration` field — clip duration is already known from
//     AudioClip.in/out at the call site).
//   - Normalization preserved from pneuma upstream lines 75-77 (divide by
//     globalMax with 0.001 floor) — keeps quiet clips visible without
//     blowing up an all-zero stub.
import { useEffect, useState } from "react";

const BUCKETS = 128;

const cache = new Map<string, Promise<Float32Array>>();

async function decodeAndBucket(src: string): Promise<Float32Array> {
  const cached = cache.get(src);
  if (cached) return cached;
  const promise = (async () => {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`fetch ${src} failed`);
    const buf = await res.arrayBuffer();
    const ctx = new AudioContext();
    try {
      const audio = await ctx.decodeAudioData(buf);
      const channel = audio.getChannelData(0);
      const samplesPerBar = Math.max(1, Math.floor(channel.length / BUCKETS));
      const peaks = new Float32Array(BUCKETS);
      for (let i = 0; i < BUCKETS; i++) {
        let max = 0;
        const start = i * samplesPerBar;
        const end = Math.min(channel.length, start + samplesPerBar);
        for (let j = start; j < end; j++) {
          const v = Math.abs(channel[j]);
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
      // Normalize to [0, 1] (pneuma upstream lines 75-77).
      let globalMax = 0.001;
      for (let i = 0; i < peaks.length; i++) {
        if (peaks[i] > globalMax) globalMax = peaks[i];
      }
      for (let i = 0; i < peaks.length; i++) {
        peaks[i] = Math.min(1, peaks[i] / globalMax);
      }
      return peaks;
    } finally {
      ctx.close?.();
    }
  })();
  cache.set(src, promise);
  promise.catch(() => cache.delete(src));
  return promise;
}

export function useWaveform(src: string): {
  peaks: Float32Array | null;
  loading: boolean;
} {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!src) {
      setPeaks(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    decodeAndBucket(src)
      .then((p) => {
        if (!alive) return;
        setPeaks(p);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setPeaks(null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [src]);

  return { peaks, loading };
}

/** Test-only escape hatch for the module-scoped decode cache. */
export function _resetWaveformCacheForTests(): void {
  cache.clear();
}

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
//   - Cache is module-scoped, keyed on `src` only, so concurrent hooks for
//     the same audio share the in-flight decode (D9 promise dedupe).
//     Pneuma uses a useRef map keyed on `${url}:${bars}` and would re-fetch
//     on remount; module scope is the correct level for cache lifetime in
//     this React tree.
//   - Returned shape is `{ peaks: Float32Array | null; loading: boolean;
//     sourceDuration: number | null }`. Pneuma returns
//     `{ waveform: { peaks; duration } | null; loading }` — we keep the
//     fields flat at the top level. `sourceDuration` is the decoded
//     AudioBuffer.duration (the SOURCE audio's full length, not the
//     trimmed clip duration); WaveformBars needs it to slice peaks by
//     source-relative position when clip.in > 0.
//   - Normalization preserved from pneuma upstream lines 75-77 (divide by
//     globalMax with 0.001 floor) — keeps quiet clips visible without
//     blowing up an all-zero stub.
import { useEffect, useState } from "react";

// e2e-report (2026-05-12): bucket count is duration-scaled, not a fixed 128.
//
// Why: a fixed 128 fails for any clip much shorter than the source audio.
// Example: 11.5s BGM clip from a 171s music bed → WaveformBars slices
// peaks[0..ceil(11.5/171*128)] = peaks[0..9] = just 9 bars covering ~1.3s
// each. The rendered waveform looked blocky and bore no resemblance to
// what the user hears in that 11.5s. The fix is to compute peaks at a
// fixed *temporal density* (32 buckets per second of source audio)
// so any sub-window slice keeps perceptually meaningful resolution.
//
//   bucketCount = clamp(MIN_BUCKETS, MAX_BUCKETS, duration * BUCKETS_PER_SEC)
//
//   - BUCKETS_PER_SEC = 32  → ~31 ms per bucket, smooth at 80 px/sec zoom.
//   - MIN_BUCKETS = 128     → floor for short clips (≤4s); also keeps the
//                             existing test fixtures (mock returns 1s audio
//                             → max(128, 32) = 128) passing unchanged.
//   - MAX_BUCKETS = 8192    → caps memory at 32 KB per cached source.
//                             A 5-min source → 9600 raw → clamped to 8192
//                             (still ~36 ms granularity, perceptually fine).
const BUCKETS_PER_SEC = 32;
const MIN_BUCKETS = 128;
const MAX_BUCKETS = 8192;

interface DecodedWaveform {
  peaks: Float32Array;
  durationSec: number;
}

const cache = new Map<string, Promise<DecodedWaveform>>();

// Phase B (2026-05-25): server pre-computes `<src>.peaks.json` (Peaks.js
// v2 shape) so the frontend can render waveforms without decoding the
// whole audio file in WebAudio. Try the JSON first; fall back to client-
// side decode for assets that haven't been backfilled yet.
//
// Returns null (not throws) on any failure so the caller cleanly falls
// through. Refuses HTML content-type up-front (SPA fallback masquerading
// as 200 OK) for the same reason audio decode needs the guard.
async function tryFetchPeaksJson(src: string): Promise<DecodedWaveform | null> {
  try {
    const res = await fetch(`${src}.peaks.json`);
    if (!res.ok) return null;
    // SPA-fallback guard: a missing route returns index.html with 200.
    // Don't require json content-type (Hono's static handler may serve
    // peaks.json as application/octet-stream); just refuse html.
    const ct = res.headers?.get?.("content-type") ?? "";
    if (ct.includes("text/html")) return null;
    const data = await res.json();
    if (
      data?.version !== 2 ||
      !Array.isArray(data.channels) ||
      !Array.isArray(data.channels[0])
    ) {
      return null;
    }
    // #30 — fold all channels to one display waveform on the fly (per-channel
    // data stays in storage for future L-only/R-only/stacked modes). The issue
    // says "summed"; we fold by MAX-across-channels rather than an arithmetic
    // sum because (a) it stays in [0,1] like the rest of the pipeline and (b) a
    // literal sum would saturate stereo content to 1.0 and render a solid block.
    // Max also matches the WebAudio path's per-bucket max-abs semantics.
    const channels = data.channels as number[][];
    const len = channels[0].length;
    const peaks = new Float32Array(len);
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      for (let i = 0; i < len; i++) {
        const v = ch[i] ?? 0;
        if (v > peaks[i]) peaks[i] = v;
      }
    }
    return {
      peaks,
      durationSec: Number(data.durationSec) || 0,
    };
  } catch {
    return null;
  }
}

async function webAudioDecodeAndBucket(src: string): Promise<DecodedWaveform> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`fetch ${src} failed (HTTP ${res.status})`);
  // SPA-fallback guard: if the URL doesn't match a server route, vite/the
  // hono dist handler returns index.html with HTTP 200 + text/html.
  // decodeAudioData on html bytes throws an opaque EncodingError that
  // historically masqueraded as "still loading" — refuse it up-front
  // with a useful message instead. See feedback memory
  // `git-checkout-path-dot-silent-revert` for the original incident.
  const ct = res.headers?.get?.("content-type") ?? "";
  if (ct.includes("text/html")) {
    throw new Error(
      `${src} returned text/html (likely SPA fallback). Pass an asset URL routed by the server — e.g. /api/works/<id>/assets/<file>.`,
    );
  }
  const buf = await res.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const channel = audio.getChannelData(0);
    const bucketCount = Math.min(
      MAX_BUCKETS,
      Math.max(MIN_BUCKETS, Math.ceil(audio.duration * BUCKETS_PER_SEC)),
    );
    const samplesPerBar = Math.max(1, Math.floor(channel.length / bucketCount));
    const peaks = new Float32Array(bucketCount);
    for (let i = 0; i < bucketCount; i++) {
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
    return { peaks, durationSec: audio.duration };
  } finally {
    ctx.close?.();
  }
}

async function decodeAndBucket(src: string): Promise<DecodedWaveform> {
  const cached = cache.get(src);
  if (cached) return cached;
  const promise = (async () => {
    const jsonResult = await tryFetchPeaksJson(src);
    if (jsonResult) return jsonResult;
    return webAudioDecodeAndBucket(src);
  })();
  cache.set(src, promise);
  promise.catch((err: unknown) => {
    cache.delete(src);
    // Surface every decode failure: a stuck-loading waveform must never
    // again pass as "everything's fine" (the 2026-05-25 SPA-fallback
    // silent leak). Keep this at warn — UI also renders ⚠.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[useWaveform] decode failed: ${msg}`);
  });
  return promise;
}

export interface UseWaveformResult {
  peaks: Float32Array | null;
  loading: boolean;
  /** Duration of the SOURCE audio (decoded AudioBuffer.duration), in seconds.
   *  Null while loading or on failure. Callers slicing peaks for a trimmed
   *  clip must compute indices as `clip.in / sourceDuration` and
   *  `clip.out / sourceDuration` — the peaks array spans the full source. */
  sourceDuration: number | null;
  /** Non-null only after a fetch+decode attempt has permanently failed.
   *  UI uses this to distinguish "still loading" (gradient placeholder)
   *  from "permanently unavailable" (visible ⚠ — kdenlive convention). */
  error: string | null;
}

export function useWaveform(src: string): UseWaveformResult {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [sourceDuration, setSourceDuration] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setPeaks(null);
      setSourceDuration(null);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    decodeAndBucket(src)
      .then(({ peaks: p, durationSec }) => {
        if (!alive) return;
        setPeaks(p);
        setSourceDuration(durationSec);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setPeaks(null);
        setSourceDuration(null);
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [src]);

  return { peaks, loading, sourceDuration, error };
}

/** Test-only escape hatch for the module-scoped decode cache. */
export function _resetWaveformCacheForTests(): void {
  cache.clear();
}

import { useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useComposition } from "../store";
import { snapToBeat } from "../panels/Timeline/snapToBeat";

interface BeatsResponse {
  success: boolean;
  beats?: number[];
  strongBeats?: number[];
  bpm?: number | null;
}

/**
 * Loads beat times for a given audio asset and stashes them in the
 * composition store so any clip-drag handler can call snap() against the
 * shared list. Calls POST /api/audio/beats which shells out to
 * skills/.../detect_beats.py (librosa). If the server returns 503 (librosa
 * not installed) we fall back to an empty list so snap calls no-op cleanly.
 */
export function useBeatSnap(opts: {
  workId: string | null;
  assetPath: string | null;
}) {
  const setBeats = useComposition((s) => s.setBeats);
  const beats = useComposition((s) => s.beats);

  useEffect(() => {
    if (!opts.workId || !opts.assetPath) return;
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch<BeatsResponse>(
          "/api/audio/beats",
          {
            method: "POST",
            body: { workId: opts.workId, assetPath: opts.assetPath },
          },
        );
        if (alive && Array.isArray(res.beats)) setBeats(res.beats);
      } catch {
        // 503 (no librosa), 500, or network — beat snap silently no-ops
        if (alive) setBeats([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [opts.workId, opts.assetPath, setBeats]);

  const snap = useCallback(
    (t: number, toleranceSec = 0.05) =>
      snapToBeat(t, beats, toleranceSec),
    [beats],
  );

  return { beats, snap };
}

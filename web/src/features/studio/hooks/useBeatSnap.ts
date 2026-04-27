import { useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useComposition } from "../store";
import { snapToBeat } from "../panels/Timeline/snapToBeat";

interface AnalyzeResponse {
  success: boolean;
  beats?: number[];
}

/**
 * Loads beat times for a given audio asset and stashes them in the
 * composition store so any clip-drag handler can call snap() against the
 * shared list. The /api/audio/analyze endpoint may or may not include
 * beats today; if absent we fall back to an empty list so snap calls
 * become no-ops.
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
        const res = await apiFetch<AnalyzeResponse>(
          "/api/audio/analyze",
          {
            method: "POST",
            body: { workId: opts.workId, assetPath: opts.assetPath },
          },
        );
        if (alive && Array.isArray(res.beats)) setBeats(res.beats);
      } catch {
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

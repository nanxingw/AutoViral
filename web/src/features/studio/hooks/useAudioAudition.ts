// A6 (PRD-0010) — useAudioAudition: single-instance in-place audio preview.
//
// The AUDIO library row previews a clip in place. Product rule: only ONE
// audition sounds at a time. A module-scoped singleton (one HTMLAudioElement +
// the currently-active src) enforces this across every row instance:
//   - starting B stops A (we pause + drop A's element before creating B);
//   - unmounting the active row stops it — this is how a work switch stops
//     playback, since switching works unmounts the whole library subtree;
//   - the clip ending resets to not-playing (row's ▶ returns).
//
// Rows subscribe via useSyncExternalStore to the active-src snapshot, so the
// one playing row shows ⏸ and every other row shows ▶ with zero prop drilling.
import { useCallback, useEffect, useSyncExternalStore } from "react";

let audioEl: HTMLAudioElement | null = null;
let activeSrc: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): string | null {
  return activeSrc;
}

/** Tear down the current element (pause + release) and clear active state. */
function stopAudition(): void {
  if (audioEl) {
    try {
      audioEl.pause();
    } catch {
      /* element already detached — ignore */
    }
    audioEl = null;
  }
  if (activeSrc !== null) {
    activeSrc = null;
    emit();
  }
}

function startAudition(src: string): void {
  // Singleton invariant: whatever was sounding stops before the new one starts.
  if (audioEl) {
    try {
      audioEl.pause();
    } catch {
      /* ignore */
    }
    audioEl = null;
  }
  const el = new Audio(src);
  // addEventListener (not onended=) so a synthetic 'ended' in tests fires too,
  // and so the guard survives even if some caller reassigns onended.
  el.addEventListener("ended", () => {
    if (activeSrc === src && audioEl === el) stopAudition();
  });
  audioEl = el;
  activeSrc = src;
  emit();
  // play() rejects on autoplay policy / detached element — swallow: the UI
  // already reflects "playing"; a rejected promise must not crash the row.
  void el.play?.()?.catch?.(() => {});
}

export interface AudioAuditionState {
  /** True iff THIS src is the one currently sounding. */
  playing: boolean;
  /** Play this src (stopping any other), or pause it if already playing. */
  toggle: () => void;
}

export function useAudioAudition(src: string): AudioAuditionState {
  const active = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const playing = src !== "" && active === src;

  const toggle = useCallback(() => {
    if (!src) return;
    if (activeSrc === src) stopAudition();
    else startAudition(src);
  }, [src]);

  useEffect(() => {
    return () => {
      // If the row that owns the active audition unmounts (row removed, tab
      // switched, or work switched → whole library unmounts), stop it.
      if (activeSrc === src) stopAudition();
    };
  }, [src]);

  return { playing, toggle };
}

/** Test-only: reset the module singleton between cases. */
export function _resetAuditionForTests(): void {
  if (audioEl) {
    try {
      audioEl.pause();
    } catch {
      /* ignore */
    }
  }
  audioEl = null;
  activeSrc = null;
  listeners.clear();
}

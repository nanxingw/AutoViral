import { useCallback, useEffect, useRef, useState } from "react";
import { acquireMediaSlot, type MediaSlot } from "./mediaLoadGate";

/**
 * Defer a media element's `src` until the global {@link acquireMediaSlot} gate
 * grants a load slot (issue #37). Until then the returned `src` is `undefined`,
 * so the element mounts WITHOUT opening a connection — the caller renders a
 * lightweight placeholder instead.
 *
 * The consumer MUST call the returned `onSettled` once the element has the data
 * it needs (e.g. `onLoadedMetadata` for a poster frame, or `onError`). That
 * releases the slot so the next queued element can load — without unmounting,
 * since the loaded frame stays painted. Unmounting also releases the slot
 * (cancelling the queue spot if it was never granted), so a slot can never leak.
 *
 * @param realSrc the URL to load once a slot is granted
 * @param enabled gate only while true (e.g. a video tile not in failed state)
 */
export function useGatedMediaSrc(
  realSrc: string | undefined,
  enabled = true,
): { src: string | undefined; onSettled: () => void } {
  const [granted, setGranted] = useState(false);
  const slotRef = useRef<MediaSlot | null>(null);

  useEffect(() => {
    setGranted(false);
    if (!enabled || !realSrc) {
      slotRef.current = null;
      return;
    }
    let alive = true;
    const slot = acquireMediaSlot();
    slotRef.current = slot;
    void slot.granted.then(() => {
      if (alive) setGranted(true);
    });
    return () => {
      alive = false;
      slot.release();
      slotRef.current = null;
    };
  }, [realSrc, enabled]);

  const onSettled = useCallback(() => {
    slotRef.current?.release();
  }, []);

  return { src: granted && enabled ? realSrc : undefined, onSettled };
}

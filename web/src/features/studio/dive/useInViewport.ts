import { useEffect, useRef, useState } from "react";

// B5 (PRD-0010) — a one-shot "has this element ever entered the viewport?"
// gate. Used to defer <video> metadata loading in the Dive canvas: a graph of
// N off-screen clip nodes must not each fire a metadata request on mount
// (mirrors the #37 concurrent-decode class). Once seen, we latch to true and
// stop observing — the poster only needs to load once.
//
// When IntersectionObserver is unavailable (SSR / ancient env) we default to
// visible so nothing silently stays blank.
export function useInViewport<T extends Element>(): {
  ref: React.RefObject<T | null>;
  inView: boolean;
} {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
          return;
        }
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, inView };
}

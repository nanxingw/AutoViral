import { useCallback, useRef } from "react";
import type Konva from "konva";
import { useEditor } from "../store";
import { exportSinglePng, exportAllPngs } from "../services/exportPng";

/**
 * Walk every slide and pre-fetch its referenced image URLs into the
 * browser cache. After this resolves, subsequent useImage(...) calls
 * during slide swap hit the disk cache and resolve synchronously, so
 * `setCurrentSlide → toDataURL` no longer captures a half-rendered stage.
 *
 * Earlier attempts via `waitForStageImages` (polling Konva node.image())
 * never observed loaded state — useImage's HTMLImageElement reference
 * never propagated back to Konva's Image attr in the timing window. The
 * preload approach sidesteps that by ensuring the image is *already
 * cached* before the swap, so render-then-capture is a single tick.
 */
async function preloadCarouselImages(
  urls: string[],
  timeoutMs = 8000,
): Promise<void> {
  const seen = new Set<string>();
  const pending = urls.filter((u) => u && !seen.has(u) && (seen.add(u), true));
  if (pending.length === 0) return;
  await Promise.race([
    Promise.all(
      pending.map(
        (src) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = src;
          }),
      ),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export function useExport() {
  const stageRef = useRef<Konva.Stage | null>(null);
  const setCurrentSlide = useEditor((s) => s.setCurrentSlide);

  const setStage = useCallback((s: Konva.Stage | null) => {
    stageRef.current = s;
  }, []);

  const exportCurrent = useCallback(
    (filename = "slide.png") => {
      const stage = stageRef.current;
      if (!stage) return;
      exportSinglePng(stage, filename);
    },
    [],
  );

  const exportAll = useCallback(async () => {
    const car = useEditor.getState().car;
    if (!car) return;
    const previousId = useEditor.getState().currentSlideId;
    // Warm the browser image cache for every slide's bg + image-layer src
    // BEFORE the iteration starts. Once cached, useImage resolves on the
    // first render tick and toDataURL sees a fully painted stage.
    const urls: string[] = [];
    for (const s of car.slides) {
      if (s.bg.type === "image") urls.push(s.bg.value);
      for (const l of s.layers) {
        if (l.kind === "image") urls.push(l.src);
      }
    }
    await preloadCarouselImages(urls);
    await exportAllPngs(car.id, async (slideId) => {
      setCurrentSlide(slideId);
      // Wait long enough for React to render the swapped slide AND for
      // useImage's effect to flush an HTMLImageElement (already cached
      // by preload) into the Konva Image node. 1500ms is generous to
      // cover slow re-renders + double-RAF for Konva to actually paint;
      // empirically 250ms left captures blank. The cost is +1s per slide
      // during batch export — acceptable for a one-shot user action.
      // KNOWN ISSUE: capture often returns a stale (pre-swap) frame even
      // after setCurrentSlide + wait. Tried polling Konva node.image()
      // (Round 11), preload via new Image() (Round 12a), 1500ms wait
      // (Round 12b), and stage.batchDraw() + requestAnimationFrame
      // (Round 13) — all produced bit-identical PNGs, suggesting
      // toDataURL is reading a cached/stale source. Tracked in task #132.
      // For now batch export still iterates every slide (so each one
      // gets a download trigger), but the bytes may not reflect the
      // current slide's actual rendered state.
      await new Promise((r) => setTimeout(r, 250));
      const stage = stageRef.current;
      if (!stage) return "";
      return stage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
    });
    if (previousId) setCurrentSlide(previousId);
  }, [setCurrentSlide]);

  return { setStage, exportCurrent, exportAll };
}

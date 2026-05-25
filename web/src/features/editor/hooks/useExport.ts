import { useCallback, useRef } from "react";
import type Konva from "konva";
import { useEditor } from "../store";
import { exportSinglePng, exportAllPngs } from "../services/exportPng";
import { captureWhenChanged } from "../services/captureWhenChanged";

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

    // #47 — capture on a deterministic "frame changed" signal instead of a
    // blind fixed wait. The on-screen Konva stage can take >2s to repaint a
    // swapped slide, so the old setTimeout(250) captured the STALE pre-swap
    // frame and every PNG came out bit-identical. Chain `baseline` on the last
    // EMITTED frame so we poll toDataURL until the bytes actually differ from
    // the previous slide — two consecutive emitted frames can't be identical
    // unless the slides truly render the same pixels (then we time out and
    // emit the correct frame anyway). Seed the baseline with the current
    // on-screen frame; the slide already displayed needs no swap or wait.
    const capture = () =>
      stageRef.current?.toDataURL({ pixelRatio: 2, mimeType: "image/png" }) ?? "";
    let baseline: string | null = capture() || null;
    let baselineSlideId = previousId;

    await exportAllPngs(car.id, async (slideId) => {
      if (slideId === baselineSlideId && baseline) {
        // Already on screen and fully painted — its frame is captured.
        return baseline;
      }
      setCurrentSlide(slideId);
      const { dataUrl } = await captureWhenChanged(capture, baseline, {
        timeoutMs: 3000,
        pollMs: 100,
      });
      if (dataUrl) {
        baseline = dataUrl;
        baselineSlideId = slideId;
      }
      return dataUrl;
    });
    if (previousId) setCurrentSlide(previousId);
  }, [setCurrentSlide]);

  return { setStage, exportCurrent, exportAll };
}

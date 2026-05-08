import type Konva from "konva";
import { useEditor } from "../store";

export interface StageLike {
  toDataURL: (config?: {
    pixelRatio?: number;
    mimeType?: string;
  }) => string;
}

function triggerDownload(href: string, fileName: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function exportSinglePng(
  stage: StageLike | Konva.Stage,
  fileName: string,
): void {
  const dataUrl = stage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
  triggerDownload(dataUrl, fileName);
}

/**
 * Walks every slide in the current carousel, capturing each via the supplied
 * `capture` function, then triggers a download for each result. The caller is
 * responsible for swapping the active slide before each capture.
 *
 * Errors from `capture` (e.g. Konva stage not ready, tainted canvas, transient
 * render hiccup) are caught per-slide so a single failure can't silently abort
 * the rest of the iteration — the user gets every slide that *can* render
 * plus a console warning for the ones that can't.
 */
export async function exportAllPngs(
  carouselId: string,
  capture: (slideId: string) => Promise<string>,
): Promise<void> {
  const slides = useEditor.getState().car?.slides ?? [];
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    try {
      const url = await capture(slide.id);
      if (!url) {
        console.warn(`[exportAllPngs] empty capture for slide ${slide.id}; skipping`);
        continue;
      }
      triggerDownload(
        url,
        `${carouselId}-${String(i + 1).padStart(2, "0")}.png`,
      );
    } catch (err) {
      console.warn(`[exportAllPngs] capture failed for slide ${slide.id}:`, err);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

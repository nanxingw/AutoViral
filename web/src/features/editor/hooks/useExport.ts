import { useCallback, useRef } from "react";
import type Konva from "konva";
import { useEditor } from "../store";
import { exportSinglePng, exportAllPngs } from "../services/exportPng";

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
    await exportAllPngs(car.id, async (slideId) => {
      setCurrentSlide(slideId);
      // Wait one micro-tick for Konva to redraw after slide swap.
      await new Promise((r) => setTimeout(r, 60));
      const stage = stageRef.current;
      if (!stage) return "";
      return stage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
    });
    if (previousId) setCurrentSlide(previousId);
  }, [setCurrentSlide]);

  return { setStage, exportCurrent, exportAll };
}

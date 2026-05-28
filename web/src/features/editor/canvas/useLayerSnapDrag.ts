import { useCallback } from "react";
import type Konva from "konva";
import { useEditor } from "../store";
import { computeSnap } from "./snapping";
import type { Layer } from "../types";

/**
 * #59 — shared drag handlers that add smart-guide snapping to any carousel
 * layer node (text / image / shape / sticker are isomorphic — all carry a
 * `box`). onDragMove snaps the live node position to the canvas centre/edges
 * and to sibling layers, publishing guide lines for the Stage to draw;
 * onDragEnd commits the final box and clears the guides.
 *
 * Escape valve: holding Alt / Ctrl / Cmd disables snapping for precise
 * free placement (Canva/Express parity).
 */
export function useLayerSnapDrag(layer: Layer) {
  const car = useEditor((s) => s.car);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const updateLayer = useEditor((s) => s.updateLayer);
  const setSnapGuides = useEditor((s) => s.setSnapGuides);

  const onDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const evt = e.evt as unknown as {
        altKey?: boolean;
        ctrlKey?: boolean;
        metaKey?: boolean;
      };
      if (evt.altKey || evt.ctrlKey || evt.metaKey || !car || !currentSlideId) {
        setSnapGuides([]);
        return; // free drag — no snap, no guides
      }
      const slide = car.slides.find((sl) => sl.id === currentSlideId);
      const targets = (slide?.layers ?? [])
        .filter((l) => l.id !== layer.id)
        .map((l) => l.box);
      const res = computeSnap(
        { x: node.x(), y: node.y(), w: node.width(), h: node.height() },
        targets,
        { width: car.width, height: car.height },
      );
      node.x(res.x);
      node.y(res.y);
      setSnapGuides(res.guides);
    },
    [car, currentSlideId, layer.id, setSnapGuides],
  );

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      updateLayer(layer.id, {
        box: { ...layer.box, x: node.x(), y: node.y() },
      });
      setSnapGuides([]);
    },
    [updateLayer, layer.id, layer.box, setSnapGuides],
  );

  return { onDragMove, onDragEnd };
}

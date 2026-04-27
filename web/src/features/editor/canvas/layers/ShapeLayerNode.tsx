import { Rect, Circle, Line, Transformer } from "react-konva";
import { useRef, useEffect } from "react";
import type Konva from "konva";
import type { ShapeLayer } from "../../types";
import { useEditor } from "../../store";

export function ShapeLayerNode({ layer }: { layer: ShapeLayer }) {
  const isSelected = useEditor((s) => s.selectionLayerId === layer.id);
  const setSelection = useEditor((s) => s.setSelectionLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const ref = useRef<Konva.Node | null>(null);
  const trRef = useRef<Konva.Transformer | null>(null);

  useEffect(() => {
    if (isSelected && ref.current && trRef.current) {
      trRef.current.nodes([ref.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const common = {
    x: layer.box.x,
    y: layer.box.y,
    rotation: layer.box.rotation,
    fill: layer.fill,
    stroke: layer.stroke ?? undefined,
    strokeWidth: layer.strokeWidth,
    draggable: true,
    onClick: () => setSelection(layer.id),
    onTap: () => setSelection(layer.id),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
      updateLayer(layer.id, {
        box: { ...layer.box, x: e.target.x(), y: e.target.y() },
      }),
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
      const node = e.target;
      updateLayer(layer.id, {
        box: {
          x: node.x(),
          y: node.y(),
          w: (node.width?.() ?? layer.box.w) * node.scaleX(),
          h: (node.height?.() ?? layer.box.h) * node.scaleY(),
          rotation: node.rotation(),
        },
      });
      node.scaleX(1);
      node.scaleY(1);
    },
  };

  return (
    <>
      {layer.shape === "rect" && (
        <Rect
          ref={ref as React.Ref<Konva.Rect>}
          {...common}
          width={layer.box.w}
          height={layer.box.h}
        />
      )}
      {layer.shape === "circle" && (
        <Circle
          ref={ref as React.Ref<Konva.Circle>}
          {...common}
          radius={Math.max(layer.box.w, layer.box.h) / 2}
        />
      )}
      {layer.shape === "line" && (
        <Line
          ref={ref as React.Ref<Konva.Line>}
          {...common}
          points={[0, 0, layer.box.w, layer.box.h]}
        />
      )}
      {isSelected && <Transformer ref={trRef} />}
    </>
  );
}

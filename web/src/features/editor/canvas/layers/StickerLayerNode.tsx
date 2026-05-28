import { Image as KImage, Rect, Transformer } from "react-konva";
import { useRef, useEffect } from "react";
import type Konva from "konva";
import useImage from "use-image";
import type { StickerLayer } from "../../types";
import { useEditor } from "../../store";
import { useLayerSnapDrag } from "../useLayerSnapDrag";

export function StickerLayerNode({ layer }: { layer: StickerLayer }) {
  const isSelected = useEditor((s) => s.selectionLayerId === layer.id);
  const setSelection = useEditor((s) => s.setSelectionLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const ref = useRef<Konva.Image | null>(null);
  const trRef = useRef<Konva.Transformer | null>(null);
  const { onDragMove, onDragEnd } = useLayerSnapDrag(layer);
  // R33: same fix as ImageLayerNode — surface broken sticker URLs.
  const [img, status] = useImage(layer.src, "anonymous");

  useEffect(() => {
    if (isSelected && ref.current && trRef.current) {
      trRef.current.nodes([ref.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  if (status === "failed") {
    return (
      <Rect
        x={layer.box.x}
        y={layer.box.y}
        width={layer.box.w}
        height={layer.box.h}
        rotation={layer.box.rotation}
        stroke="#d4756c"
        strokeWidth={2}
        dash={[8, 6]}
        fill="rgba(212, 117, 108, 0.06)"
        onClick={() => setSelection(layer.id)}
        onTap={() => setSelection(layer.id)}
      />
    );
  }

  return (
    <>
      <KImage
        ref={ref}
        image={img}
        x={layer.box.x}
        y={layer.box.y}
        width={layer.box.w}
        height={layer.box.h}
        rotation={layer.box.rotation}
        draggable
        onClick={() => setSelection(layer.id)}
        onTap={() => setSelection(layer.id)}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onTransformEnd={(e) => {
          const node = e.target;
          updateLayer(layer.id, {
            box: {
              x: node.x(),
              y: node.y(),
              w: node.width() * node.scaleX(),
              h: node.height() * node.scaleY(),
              rotation: node.rotation(),
            },
          });
          node.scaleX(1);
          node.scaleY(1);
        }}
      />
      {isSelected && <Transformer ref={trRef} />}
    </>
  );
}

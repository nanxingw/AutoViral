import { Image as KImage, Transformer } from "react-konva";
import { useRef, useEffect } from "react";
import type Konva from "konva";
import useImage from "use-image";
import type { StickerLayer } from "../../types";
import { useEditor } from "../../store";

export function StickerLayerNode({ layer }: { layer: StickerLayer }) {
  const isSelected = useEditor((s) => s.selectionLayerId === layer.id);
  const setSelection = useEditor((s) => s.setSelectionLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const ref = useRef<Konva.Image | null>(null);
  const trRef = useRef<Konva.Transformer | null>(null);
  const [img] = useImage(layer.src, "anonymous");

  useEffect(() => {
    if (isSelected && ref.current && trRef.current) {
      trRef.current.nodes([ref.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

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
        onDragEnd={(e) =>
          updateLayer(layer.id, {
            box: { ...layer.box, x: e.target.x(), y: e.target.y() },
          })
        }
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

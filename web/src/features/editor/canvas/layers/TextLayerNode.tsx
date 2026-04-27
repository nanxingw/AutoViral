import { Text, Transformer } from "react-konva";
import { useRef, useEffect } from "react";
import type Konva from "konva";
import type { TextLayer } from "../../types";
import { useEditor } from "../../store";

const FONT_FAMILY: Record<TextLayer["style"]["font"], string> = {
  serif: "Instrument Serif, serif",
  sans: "Inter, sans-serif",
  mono: "JetBrains Mono, monospace",
};

export function TextLayerNode({ layer }: { layer: TextLayer }) {
  const isSelected = useEditor((s) => s.selectionLayerId === layer.id);
  const setSelection = useEditor((s) => s.setSelectionLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const ref = useRef<Konva.Text | null>(null);
  const trRef = useRef<Konva.Transformer | null>(null);

  useEffect(() => {
    if (isSelected && ref.current && trRef.current) {
      trRef.current.nodes([ref.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  return (
    <>
      <Text
        ref={ref}
        x={layer.box.x}
        y={layer.box.y}
        width={layer.box.w}
        rotation={layer.box.rotation}
        text={layer.text}
        fontFamily={FONT_FAMILY[layer.style.font]}
        fontSize={layer.style.size}
        fontStyle={
          layer.style.italic ? "italic" : `normal ${layer.style.weight}`
        }
        fill={layer.style.color}
        align={layer.style.align}
        letterSpacing={layer.style.tracking}
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

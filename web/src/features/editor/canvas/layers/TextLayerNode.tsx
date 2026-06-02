import { Text, Transformer } from "react-konva";
import { useRef, useEffect } from "react";
import type Konva from "konva";
import type { TextLayer } from "../../types";
import { useEditor } from "../../store";
import { PALETTES } from "../../palettes";
import { useLayerSnapDrag } from "../useLayerSnapDrag";

const FONT_FAMILY: Record<TextLayer["style"]["font"], string> = {
  serif: "Instrument Serif, serif",
  sans: "Inter, sans-serif",
  mono: "JetBrains Mono, monospace",
};

/** Sentinel layer.style.color value meaning "use the palette's foreground".
 *  Lets new layers default to palette-tracking instead of hard-coding a hex
 *  the moment they're created. */
const PALETTE_FG = "palette:fg";
const PALETTE_ACCENT = "palette:accent";

export function TextLayerNode({ layer }: { layer: TextLayer }) {
  const isSelected = useEditor((s) => s.selectionLayerId === layer.id);
  const setSelection = useEditor((s) => s.setSelectionLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const globals = useEditor((s) => s.car?.globals);
  const ref = useRef<Konva.Text | null>(null);
  const trRef = useRef<Konva.Transformer | null>(null);
  const { onDragMove, onDragEnd } = useLayerSnapDrag(layer);

  // Resolve palette sentinels + globals.headlineFont fallback so DesignTab's
  // controls actually surface on every text layer that hasn't overridden.
  const palette = globals ? PALETTES[globals.palette] : undefined;
  const fontFamily = FONT_FAMILY[
    layer.style.font ?? globals?.headlineFont ?? "serif"
  ];
  const resolvedColor = (() => {
    if (layer.style.color === PALETTE_FG && palette) return palette.fg;
    if (layer.style.color === PALETTE_ACCENT && palette) return palette.accent;
    if (!layer.style.color && palette) return palette.fg;
    return layer.style.color;
  })();

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
        id={layer.id}
        x={layer.box.x}
        y={layer.box.y}
        width={layer.box.w}
        rotation={layer.box.rotation}
        text={layer.text}
        fontFamily={fontFamily}
        fontSize={layer.style.size}
        fontStyle={
          layer.style.italic ? "italic" : `normal ${layer.style.weight}`
        }
        fill={resolvedColor}
        align={layer.style.align}
        letterSpacing={layer.style.tracking}
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

import { forwardRef } from "react";
import { Stage as KStage, Layer as KLayer } from "react-konva";
import type Konva from "konva";
import { useEditor } from "../store";
import { Background } from "./background/Background";
import { TextLayerNode } from "./layers/TextLayerNode";
import { ImageLayerNode } from "./layers/ImageLayerNode";
import { ShapeLayerNode } from "./layers/ShapeLayerNode";
import { StickerLayerNode } from "./layers/StickerLayerNode";

interface StageProps {
  scale?: number;
}

/**
 * Konva canvas binding for the currently-selected slide. The forwarded ref
 * lets the page hold onto the underlying Konva.Stage so we can call
 * `stage.toDataURL()` for PNG export without going through the DOM.
 */
export const Stage = forwardRef<Konva.Stage, StageProps>(function Stage(
  { scale = 0.5 },
  ref,
) {
  const car = useEditor((s) => s.car);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const setSelection = useEditor((s) => s.setSelectionLayer);

  if (!car || !currentSlideId) return null;
  const slide = car.slides.find((s) => s.id === currentSlideId);
  if (!slide) return null;

  return (
    <KStage
      ref={ref}
      width={car.width * scale}
      height={car.height * scale}
      scaleX={scale}
      scaleY={scale}
      onMouseDown={(e) => {
        // click on empty stage clears selection
        if (e.target === e.target.getStage()) setSelection(null);
      }}
    >
      <KLayer>
        <Background bg={slide.bg} width={car.width} height={car.height} />
        {slide.layers.map((l) => {
          if (l.kind === "text") return <TextLayerNode key={l.id} layer={l} />;
          if (l.kind === "image")
            return <ImageLayerNode key={l.id} layer={l} />;
          if (l.kind === "shape")
            return <ShapeLayerNode key={l.id} layer={l} />;
          return <StickerLayerNode key={l.id} layer={l} />;
        })}
      </KLayer>
    </KStage>
  );
});

import { forwardRef, useState } from "react";
import { Stage as KStage, Layer as KLayer, Line } from "react-konva";
import type Konva from "konva";
import { useEditor } from "../store";
import type { Layer } from "../types";
import { Background } from "./background/Background";
import { EffectsOverlay } from "./EffectsOverlay";
import { TextLayerNode } from "./layers/TextLayerNode";
import { ImageLayerNode } from "./layers/ImageLayerNode";
import { ShapeLayerNode } from "./layers/ShapeLayerNode";
import { StickerLayerNode } from "./layers/StickerLayerNode";
import { ContextMenu } from "@/components/ContextMenu";
import { useComposerDraft } from "@/stores/composerDraft";
import { describeLayer } from "@/features/chat/describeElement";
import { useT } from "@/i18n/useT";

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
  const snapGuides = useEditor((s) => s.snapGuides);
  // #5 — right-click "加入聊天上下文" menu anchor (viewport coords) + the layer.
  const inject = useComposerDraft((s) => s.inject);
  const t = useT();
  const [menu, setMenu] = useState<{ layer: Layer; x: number; y: number } | null>(
    null,
  );

  if (!car || !currentSlideId) return null;
  const slide = car.slides.find((s) => s.id === currentSlideId);
  if (!slide) return null;

  // Konva events bubble to the stage; each layer node carries id={layer.id},
  // so we resolve the right-clicked node back to its layer. Background /
  // overlay / empty stage have no id → no menu (browser default left alone).
  const handleContextMenu = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const id = e.target.id();
    const layer = id ? slide.layers.find((l) => l.id === id) : undefined;
    if (!layer) return;
    e.evt.preventDefault();
    setSelection(layer.id); // select so buildEditorViewerContext carries this layer's id
    setMenu({ layer, x: e.evt.clientX, y: e.evt.clientY });
  };

  return (
    <>
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
      onContextMenu={handleContextMenu}
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
        {/* Editorial film-grain + bottom vignette per car.globals.effects.
            Layered last so they sit above all content. */}
        <EffectsOverlay
          width={car.width}
          height={car.height}
          grain={car.globals.effects.grain}
          gradient={car.globals.effects.gradient}
        />
        {/* #59 — smart-guide lines while dragging. Drawn last so they sit on
            top; non-listening so they never intercept pointer events. 2 canvas
            px ≈ 1 screen px at the 0.5 display scale. */}
        {snapGuides.map((g, i) =>
          g.axis === "x" ? (
            <Line
              key={`gx-${i}`}
              points={[g.pos, 0, g.pos, car.height]}
              stroke="#ff3b81"
              strokeWidth={2}
              listening={false}
            />
          ) : (
            <Line
              key={`gy-${i}`}
              points={[0, g.pos, car.width, g.pos]}
              stroke="#ff3b81"
              strokeWidth={2}
              listening={false}
            />
          ),
        )}
      </KLayer>
    </KStage>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          ariaLabel={t("chat.addToContext.menuAria")}
          items={[
            {
              label: t("chat.addToContext.add"),
              onSelect: () =>
                inject(
                  describeLayer(menu.layer, {
                    text: t("chat.addToContext.layer.text"),
                    image: t("chat.addToContext.layer.image"),
                    shape: t("chat.addToContext.layer.shape"),
                    sticker: t("chat.addToContext.layer.sticker"),
                  }),
                ),
            },
          ]}
        />
      )}
    </>
  );
});

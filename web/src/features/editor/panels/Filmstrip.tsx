import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { useEditor } from "../store";
import { PALETTES } from "../palettes";
import type { Slide, Layer, TextLayer, ImageLayer } from "../types";
import { useT } from "@/i18n/useT";

// Mirror TextLayerNode's font + palette resolution so thumbs and the main
// canvas read the same — when the user swaps headlineFont or palette, both
// follow.
const THUMB_FONT_FAMILY: Record<TextLayer["style"]["font"], string> = {
  serif: "Instrument Serif, serif",
  sans: "Inter, sans-serif",
  mono: "JetBrains Mono, monospace",
};
const PALETTE_FG = "palette:fg";
const PALETTE_ACCENT = "palette:accent";

function ThumbLayers({
  layers,
  scale,
  palette,
  globalsFont,
}: {
  layers: Layer[];
  scale: number;
  palette: { bg: string; fg: string; accent: string } | undefined;
  globalsFont: TextLayer["style"]["font"];
}) {
  return (
    <>
      {layers.map((l) => {
        if (l.kind === "text") {
          const t = l as TextLayer;
          const color = (() => {
            if (t.style.color === PALETTE_FG && palette) return palette.fg;
            if (t.style.color === PALETTE_ACCENT && palette) return palette.accent;
            if (!t.style.color && palette) return palette.fg;
            return t.style.color;
          })();
          return (
            <div
              key={t.id}
              style={{
                position: "absolute",
                left: t.box.x * scale,
                top: t.box.y * scale,
                width: t.box.w * scale,
                fontSize: Math.max(4, t.style.size * scale),
                fontFamily: THUMB_FONT_FAMILY[t.style.font ?? globalsFont],
                fontStyle: t.style.italic ? "italic" : "normal",
                fontWeight: t.style.weight ?? 500,
                color,
                textAlign: t.style.align,
                letterSpacing: t.style.tracking * scale,
                lineHeight: 1.05,
                pointerEvents: "none",
                whiteSpace: "pre-line",
                overflow: "hidden",
              }}
            >
              {t.text}
            </div>
          );
        }
        if (l.kind === "image") {
          const i = l as ImageLayer;
          return (
            <img
              key={i.id}
              src={i.src}
              alt=""
              style={{
                position: "absolute",
                left: i.box.x * scale,
                top: i.box.y * scale,
                width: i.box.w * scale,
                height: i.box.h * scale,
                objectFit: "cover",
                pointerEvents: "none",
              }}
            />
          );
        }
        return null;
      })}
    </>
  );
}

function FilmThumb({
  slide,
  index,
  canDelete,
}: {
  slide: Slide;
  index: number;
  canDelete: boolean;
}) {
  const isCurrent = useEditor((s) => s.currentSlideId === slide.id);
  const setCurrent = useEditor((s) => s.setCurrentSlide);
  const removeSlide = useEditor((s) => s.removeSlide);
  const duplicateSlide = useEditor((s) => s.duplicateSlide);
  const carWidth = useEditor((s) => s.car?.width ?? 1080);
  const carPalette = useEditor((s) => s.car?.globals.palette);
  const carHeadlineFont = useEditor((s) => s.car?.globals.headlineFont ?? "serif");
  const palette = carPalette ? PALETTES[carPalette] : undefined;
  const thumbScale = 80 / carWidth;
  const [hover, setHover] = useState(false);
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slide.id });

  // Render the actual slide background — prior version only handled "solid",
  // so image-typed slides (the most common case for legacy auto-built carousels)
  // showed up as blank surface-1 boxes.
  const bgStyle: React.CSSProperties = (() => {
    if (slide.bg.type === "solid") return { background: slide.bg.value };
    if (slide.bg.type === "gradient") return { background: slide.bg.value };
    if (slide.bg.type === "image")
      return {
        backgroundImage: `url(${slide.bg.value})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    return { background: "var(--surface-1)" };
  })();

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => setCurrent(slide.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        width: 80,
        height: 100,
        borderRadius: 6,
        ...bgStyle,
        border: isCurrent
          ? "2px solid var(--accent)"
          : "1px solid var(--glass-border)",
        boxShadow: isCurrent ? "0 0 12px var(--accent-glow)" : "none",
        flexShrink: 0,
        position: "relative",
        cursor: "pointer",
        overflow: "hidden",
      }}
      data-slide-id={slide.id}
    >
      <ThumbLayers
        layers={slide.layers}
        scale={thumbScale}
        palette={palette}
        globalsFont={carHeadlineFont}
      />
      <span
        style={{
          position: "absolute",
          top: 4,
          left: 6,
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          color: "rgba(255,255,255,0.9)",
          background: "rgba(0,0,0,0.4)",
          padding: "1px 5px",
          borderRadius: 3,
          letterSpacing: "0.06em",
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      {slide.layers.length > 0 && (
        <span
          style={{
            position: "absolute",
            bottom: 4,
            right: 6,
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: "rgba(255,255,255,0.9)",
            background: "rgba(0,0,0,0.4)",
            padding: "1px 5px",
            borderRadius: 3,
          }}
        >
          {slide.layers.length}L
        </span>
      )}
      {canDelete && (
        <button
          type="button"
          aria-label={t("editor.filmstrip.deleteSlide", { index: index + 1 })}
          onClick={(e) => {
            e.stopPropagation();
            removeSlide(slide.id);
          }}
          // Block the sortable's drag listeners on this button so click
          // selects-then-deletes instead of being absorbed as a drag start.
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 18,
            height: 18,
            display: "grid",
            placeItems: "center",
            background: "rgba(0,0,0,0.55)",
            color: "rgba(255,255,255,0.95)",
            border: "none",
            borderRadius: "50%",
            cursor: "pointer",
            fontSize: 11,
            lineHeight: 1,
            padding: 0,
            opacity: hover ? 1 : 0,
            transition: "opacity 0.12s",
          }}
        >
          ×
        </button>
      )}
      <button
        type="button"
        aria-label={t("editor.filmstrip.duplicateSlide", { index: index + 1 })}
        onClick={(e) => {
          e.stopPropagation();
          duplicateSlide(slide.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 4,
          right: 26,
          width: 18,
          height: 18,
          display: "grid",
          placeItems: "center",
          background: "rgba(0,0,0,0.55)",
          color: "rgba(255,255,255,0.95)",
          border: "none",
          borderRadius: "50%",
          cursor: "pointer",
          fontSize: 10,
          lineHeight: 1,
          padding: 0,
          opacity: hover ? 1 : 0,
          transition: "opacity 0.12s",
        }}
      >
        ⎘
      </button>
    </div>
  );
}

export function Filmstrip() {
  const slides = useEditor((s) => s.car?.slides ?? []);
  const reorder = useEditor((s) => s.reorderSlides);
  const addSlide = useEditor((s) => s.addSlide);
  const t = useT();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = slides.map((s) => s.id);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    reorder(oldIdx, newIdx);
  };

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "8px 12px",
        gap: 6,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "var(--text-dimmer)",
        }}
      >
        {t("editor.filmstrip.dragToReorder")}
      </div>
      <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={slides.map((s) => s.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {slides.map((slide, idx) => (
                <FilmThumb
                  key={slide.id}
                  slide={slide}
                  index={idx}
                  canDelete={slides.length > 1}
                />
              ))}
              <button
                type="button"
                aria-label={t("editor.filmstrip.addSlide")}
                onClick={addSlide}
                style={{
                  width: 80,
                  height: 100,
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  background: "transparent",
                  color: "var(--text-dimmer)",
                  border: "1px dashed var(--glass-border)",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 24,
                  fontWeight: 300,
                  lineHeight: 1,
                  transition: "color 0.15s, border-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--accent)";
                  e.currentTarget.style.borderColor = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-dimmer)";
                  e.currentTarget.style.borderColor = "var(--glass-border)";
                }}
              >
                +
              </button>
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

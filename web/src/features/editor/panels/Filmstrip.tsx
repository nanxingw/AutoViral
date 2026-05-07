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
import type { Slide } from "../types";
import { useT } from "@/i18n/useT";

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
    </div>
  );
}

export function Filmstrip() {
  const slides = useEditor((s) => s.car?.slides ?? []);
  const reorder = useEditor((s) => s.reorderSlides);
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
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

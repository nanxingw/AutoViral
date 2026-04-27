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
import { useEditor } from "../store";
import type { Slide } from "../types";

function FilmThumb({ slide, index }: { slide: Slide; index: number }) {
  const isCurrent = useEditor((s) => s.currentSlideId === slide.id);
  const setCurrent = useEditor((s) => s.setCurrentSlide);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slide.id });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => setCurrent(slide.id)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        width: 80,
        height: 100,
        borderRadius: 4,
        background:
          slide.bg.type === "solid" ? slide.bg.value : "var(--surface-1)",
        border: isCurrent
          ? "2px solid var(--accent, #2a3a4a)"
          : "1px solid var(--border, rgba(0,0,0,0.1))",
        flexShrink: 0,
        position: "relative",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: "var(--text-dimmer)",
      }}
      data-slide-id={slide.id}
    >
      <span
        style={{
          position: "absolute",
          top: 4,
          left: 6,
          fontSize: 9,
          color: "var(--text-dimmer)",
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <span>{slide.layers.length} layers</span>
    </div>
  );
}

export function Filmstrip() {
  const slides = useEditor((s) => s.car?.slides ?? []);
  const reorder = useEditor((s) => s.reorderSlides);
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
        Drag to reorder
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
                <FilmThumb key={slide.id} slide={slide} index={idx} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

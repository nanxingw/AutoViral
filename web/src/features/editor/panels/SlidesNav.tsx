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
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEditor } from "../store";
import type { Slide } from "../types";
import { useT } from "@/i18n/useT";

function SlideThumb({ slide, index }: { slide: Slide; index: number }) {
  const isCurrent = useEditor((s) => s.currentSlideId === slide.id);
  const setCurrent = useEditor((s) => s.setCurrentSlide);
  const duplicate = useEditor((s) => s.duplicateSlide);
  const remove = useEditor((s) => s.removeSlide);
  const slideCount = useEditor((s) => s.car?.slides.length ?? 0);
  const t = useT();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slide.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        display: "flex",
        gap: 8,
        padding: 8,
        borderRadius: 8,
        background: isCurrent
          ? "var(--surface-2, rgba(0,0,0,0.06))"
          : "transparent",
        border: isCurrent
          ? "1px solid var(--accent, #2a3a4a)"
          : "1px solid var(--border, rgba(0,0,0,0.08))",
        cursor: "pointer",
        marginBottom: 6,
      }}
      {...attributes}
      onClick={() => setCurrent(slide.id)}
    >
      <div
        {...listeners}
        aria-label="Drag slide"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-dimmer)",
          cursor: "grab",
          padding: "0 4px",
          userSelect: "none",
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </div>
      <div
        style={{
          width: 80,
          height: 100,
          borderRadius: 4,
          background:
            slide.bg.type === "solid" ? slide.bg.value : "var(--surface-1)",
          border: "1px solid var(--border, rgba(0,0,0,0.06))",
          display: "grid",
          placeItems: "center",
          fontSize: 10,
          color: "var(--text-dimmer)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {t("editor.slidesNav.layersLabel", { count: slide.layers.length })}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontSize: 10,
          fontFamily: "var(--font-mono)",
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            duplicate(slide.id);
          }}
          style={btn}
        >
          {t("editor.slidesNav.btnDuplicate")}
        </button>
        <button
          type="button"
          disabled={slideCount <= 1}
          onClick={(e) => {
            e.stopPropagation();
            remove(slide.id);
          }}
          style={{ ...btn, opacity: slideCount <= 1 ? 0.4 : 1 }}
        >
          {t("editor.slidesNav.btnDelete")}
        </button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
  border: "1px solid var(--border, rgba(0,0,0,0.12))",
  background: "transparent",
  borderRadius: 3,
  cursor: "pointer",
  color: "var(--text-soft)",
};

export function SlidesNav() {
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
    // arrayMove gives us the same shape; the store mutator does splice for us.
    arrayMove(slides, oldIdx, newIdx);
    reorder(oldIdx, newIdx);
  };

  return (
    <div
      style={{
        padding: 12,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-dimmer)",
        }}
      >
        {t("editor.slidesNav.header", { count: slides.length })}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={slides.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            {slides.map((slide, idx) => (
              <SlideThumb key={slide.id} slide={slide} index={idx} />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <button
        type="button"
        onClick={addSlide}
        style={{
          padding: "8px 12px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          border: "1px dashed var(--border, rgba(0,0,0,0.2))",
          background: "transparent",
          borderRadius: 6,
          cursor: "pointer",
          color: "var(--text-soft)",
        }}
      >
        {t("editor.slidesNav.btnAdd")}
      </button>
    </div>
  );
}

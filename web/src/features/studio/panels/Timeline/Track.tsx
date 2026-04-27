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
  arrayMove,
} from "@dnd-kit/sortable";
import { useComposition } from "../../store";
import { Clip } from "./Clip";
import type { Clip as ClipModel, Track as TrackType } from "../../types";

function clipDuration(c: ClipModel): number {
  return "duration" in c ? c.duration : c.out - c.in;
}

export function Track({
  track,
  pxPerSecond,
}: {
  track: TrackType;
  pxPerSecond: number;
}) {
  const updateClip = useComposition((s) => s.updateClip);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = (track.clips as ClipModel[]).map((c) => c.id);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(track.clips as ClipModel[], oldIdx, newIdx);
    // Re-pack offsets sequentially to preserve order on the timeline.
    let cursor = 0;
    for (const c of reordered) {
      updateClip(c.id, { trackOffset: cursor });
      cursor += clipDuration(c);
    }
  };

  return (
    <div
      className="timeline-track"
      data-kind={track.kind}
      style={{
        position: "relative",
        height: 56,
        borderTop: "1px solid var(--border)",
      }}
    >
      <div
        className="track-label"
        style={{
          position: "absolute",
          left: -120,
          width: 110,
          textAlign: "right",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--text-soft)",
        }}
      >
        {track.label}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={(track.clips as ClipModel[]).map((c) => c.id)}
          strategy={horizontalListSortingStrategy}
        >
          {track.clips.map((c) => (
            <Clip key={c.id} clipId={c.id} pxPerSecond={pxPerSecond} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

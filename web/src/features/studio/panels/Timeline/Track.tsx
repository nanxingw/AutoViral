import { Clip } from "./Clip";
import type { Track as TrackType } from "../../types";

// Earlier this component wrapped clips in <DndContext> + <SortableContext>, but
// Clip never called `useSortable` — so onDragEnd never fired and the reorder
// affordance was inert. (Codex review 2026-04-27)
//
// In practice, free-position drag (handled inside Clip's onPointerDown) already
// gives the user spatial reorder by changing trackOffset. The store now also
// exposes `moveClipWithinTrack(trackId, from, to)` which any future explicit
// reorder UI (e.g. right-click → "move left") can call. dnd-kit can be re-added
// later via a Sortable wrapper around Clip without changing the data path.

export function Track({
  track,
  pxPerSecond,
}: {
  track: TrackType;
  pxPerSecond: number;
}) {
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
      {track.clips.map((c) => (
        <Clip key={c.id} clipId={c.id} pxPerSecond={pxPerSecond} />
      ))}
    </div>
  );
}

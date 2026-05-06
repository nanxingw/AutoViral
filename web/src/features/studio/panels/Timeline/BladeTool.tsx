// Phase 4.G — BladeTool: click-to-split overlay.
//
// Pneuma reference: master plan §4.2.G plus the hover-snap helper at
// `.cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/hooks/
// useSplitHoverSnap.ts`. Pneuma renders dashed guides per-clip via
// `ClipToolOverlay`; we render one absolute overlay covering the whole
// lanes container so a single pointer captures the move/click for all
// tracks. Behaviour:
//   • visible only when `store.bladeMode === true`
//   • pointermove → live hover guide (snapped to clip edges via D1=0.06s)
//   • click → resolve which clip's interval contains the snapped time
//             across all tracks, then dispatch `splitClip(clipId, t)`
//   • click in a gap → silent no-op (D4)
import type React from "react";
import { useComposition } from "../../store";
import { useSplitHoverSnap } from "./hooks/useSplitHoverSnap";
import { clipEnd, OFFSET_EPSILON } from "./clipMath";
import type { Clip } from "../../types";

export function BladeTool({
  pxPerSecond,
  totalWidth,
  labelColumnWidth,
}: {
  pxPerSecond: number;
  totalWidth: number;
  labelColumnWidth: number;
}) {
  const bladeMode = useComposition((s) => s.bladeMode);
  const splitClip = useComposition((s) => s.splitClip);
  const comp = useComposition((s) => s.comp);
  const { snapTime, snappedToEdge, setHoverTime } = useSplitHoverSnap();

  if (!bladeMode || !comp) return null;

  const localXFromEvent = (e: { clientX: number; currentTarget: EventTarget }) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX - rect.left;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const x = localXFromEvent(e);
    setHoverTime(Math.max(0, x / pxPerSecond));
  };

  const onPointerLeave = () => setHoverTime(null);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const x = localXFromEvent(e);
    // Apply the same snap as the hover guide so the click lands on the
    // same time the user sees rendered.
    const raw = Math.max(0, x / pxPerSecond);
    const t = snapTime ?? raw;
    // Find the topmost clip whose open interval (start, end) contains t.
    // Boundary equality is excluded — that would split into a zero-width
    // child, which `splitClip` no-ops anyway, but resolving it here keeps
    // gap-clicks silent (D4) instead of probing the no-op path.
    for (const track of comp.tracks) {
      const hit = (track.clips as Clip[]).find(
        (c) =>
          t > c.trackOffset + OFFSET_EPSILON && t < clipEnd(c) - OFFSET_EPSILON,
      );
      if (hit) {
        splitClip(hit.id, t);
        return;
      }
    }
    // D4 — silent no-op when the click lands in a gap.
  };

  const cursorX = snapTime !== null ? snapTime * pxPerSecond : null;

  return (
    <div
      data-testid="blade-overlay"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
      style={{
        position: "absolute",
        left: labelColumnWidth,
        top: 22, // below the sticky ruler
        width: totalWidth,
        bottom: 0,
        cursor: "crosshair",
        zIndex: 6,
      }}
    >
      {cursorX !== null && (
        <div
          style={{
            position: "absolute",
            left: cursorX,
            top: 0,
            bottom: 0,
            width: 1,
            background: snappedToEdge ? "var(--accent-hi)" : "var(--accent)",
            boxShadow: snappedToEdge ? "0 0 6px var(--accent-glow)" : "none",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

// Playhead — interactive timeline cursor.
//
// Verbatim port of master plan §4.1 lines 2298-2330 (the inline ~30-line
// component). Pneuma reference for behavioural shape:
// .cache/pneuma-clipcraft/modes/clipcraft/viewer/timeline/Playhead.tsx:1-180
//
// Differences vs. pneuma:
//   - We use Pointer Events API + setPointerCapture (master plan choice) so
//     drags survive the cursor leaving the element. Pneuma uses window-level
//     mousemove/mouseup listeners. (port hint: pneuma:81-100)
//   - D5 mounting: the parent (Timeline/index.tsx) places this as a sibling
//     of <Ruler />, offset by the 110px label column. Playhead itself is
//     unaware of the label column.
//   - We render a single full-height bar (D5) instead of pneuma's
//     visual-line + handle pair. Only the top 14px tab is interactive.
//
// Reads `currentFrame` from the store; writes via `setFrame`. `pxPerSecond`
// + `fps` come from props (parent owns zoom + comp.fps).
//
import { useRef } from "react";
import { useComposition } from "../../store";

interface PlayheadProps {
  pxPerSecond: number;
  fps: number;
}

export function Playhead({ pxPerSecond, fps }: PlayheadProps) {
  const frame = useComposition((s) => s.currentFrame);
  const setFrame = useComposition((s) => s.setFrame);
  const duration = useComposition((s) => s.comp?.duration ?? 0);
  const x = (frame / fps) * pxPerSecond;
  const maxFrame = Math.ceil(duration * fps);
  // Drag baseline captured at pointerdown so that pointermove deltas are
  // computed against the *original* clientX/frame pair (not the previous
  // event), matching pneuma's `dragTime` snapshot semantics
  // (pneuma:75-77 + 84-88).
  const dragRef = useRef<{ startX: number; startFrame: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    // setPointerCapture so a drag survives the cursor leaving the timeline
    // (the bit pneuma achieves via window-level listeners). Optional-chained
    // for jsdom which lacks the API on synthetic targets.
    target.setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startFrame: frame };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (pxPerSecond <= 0) return; // defensive: pre-zoom-resolution paint
    const dx = e.clientX - d.startX;
    setFrame(d.startFrame + Math.round((dx / pxPerSecond) * fps));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  return (
    <div
      data-testid="playhead"
      role="slider"
      aria-label="Playhead"
      aria-valuenow={frame}
      aria-valuemin={0}
      aria-valuemax={maxFrame}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: "absolute",
        left: x,
        top: 0,
        bottom: 0,
        width: 2,
        background: "var(--accent)",
        cursor: "ew-resize",
        zIndex: 7,
        boxShadow: "0 0 6px var(--accent-glow)",
        // Re-enable pointer events: the parent overlay wrapper sets
        // pointerEvents:"none" so clip drags below still work; the Playhead
        // itself opts back in for its own hit area.
        pointerEvents: "auto",
        // Avoid native touch-scroll stealing the drag on touch devices.
        touchAction: "none",
      }}
    >
      {/* 14px tab/head at the top — visually anchors the cursor and gives
          a generous hit-target. The bar below the tab is still draggable
          (cursor: ew-resize) since pointerdown anywhere on this element
          captures the pointer. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: -6,
          top: 0,
          width: 14,
          height: 14,
          background: "var(--accent)",
          borderRadius: "0 0 50% 50%",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

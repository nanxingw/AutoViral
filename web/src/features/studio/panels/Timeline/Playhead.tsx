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
// Reads `currentFrame` from the store; writes a seek intent via
// `requestSeekFrame` (S1 — PreviewPanel consumes pendingSeek to drive the
// Player). `pxPerSecond` + `fps` come from props (parent owns zoom + comp.fps).
//
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/useT";
import { useComposition } from "../../store";
import styles from "./Playhead.module.css";

interface PlayheadProps {
  pxPerSecond: number;
  fps: number;
}

export function Playhead({ pxPerSecond, fps }: PlayheadProps) {
  const t = useT();
  const frame = useComposition((s) => s.currentFrame);
  // S1 (PRD-0013) — publish a seek intent so PreviewPanel drives the Player.
  const requestSeekFrame = useComposition((s) => s.requestSeekFrame);
  const duration = useComposition((s) => s.comp?.duration ?? 0);
  const x = (frame / fps) * pxPerSecond;
  const maxFrame = Math.ceil(duration * fps);
  // Drag baseline captured at pointerdown so that pointermove deltas are
  // computed against the *original* clientX/frame pair (not the previous
  // event), matching pneuma's `dragTime` snapshot semantics
  // (pneuma:75-77 + 84-88).
  const dragRef = useRef<{ startX: number; startFrame: number } | null>(null);
  const hideTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => () => {
    if (hideTooltipTimerRef.current) clearTimeout(hideTooltipTimerRef.current);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    // setPointerCapture so a drag survives the cursor leaving the timeline
    // (the bit pneuma achieves via window-level listeners). Optional-chained
    // for jsdom which lacks the API on synthetic targets.
    target.setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startFrame: frame };
    if (hideTooltipTimerRef.current) clearTimeout(hideTooltipTimerRef.current);
    setIsScrubbing(true);
    setShowTooltip(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (pxPerSecond <= 0) return; // defensive: pre-zoom-resolution paint
    const dx = e.clientX - d.startX;
    requestSeekFrame(d.startFrame + Math.round((dx / pxPerSecond) * fps));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    setIsScrubbing(false);
    if (hideTooltipTimerRef.current) clearTimeout(hideTooltipTimerRef.current);
    hideTooltipTimerRef.current = setTimeout(() => {
      setShowTooltip(false);
      hideTooltipTimerRef.current = null;
    }, 200);
  };

  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 1;
  const roundedFrame = Math.max(0, Math.round(frame));
  const totalSeconds = Math.floor(roundedFrame / safeFps);
  const tooltipMinutes = Math.floor(totalSeconds / 60);
  const tooltipSeconds = totalSeconds % 60;
  const tooltipFrames = roundedFrame % safeFps;
  const tooltipTime = `${String(tooltipMinutes).padStart(2, "0")}:${String(tooltipSeconds).padStart(2, "0")}.${String(tooltipFrames).padStart(2, "0")}`;

  return (
    <div
      className={styles.playhead}
      data-testid="playhead"
      data-scrubbing={isScrubbing}
      role="slider"
      aria-label={t("studio.timeline.playheadAria")}
      aria-valuenow={frame}
      aria-valuemin={0}
      aria-valuemax={maxFrame}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        left: x,
      }}
    >
      <div className={styles.line} aria-hidden="true" />
      <div className={styles.handle} aria-hidden="true" />
      {showTooltip && (
        <div className={styles.tooltip} role="tooltip">
          {tooltipTime}
        </div>
      )}
    </div>
  );
}

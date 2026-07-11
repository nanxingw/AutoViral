// Ruler — the timeline time-axis, and (issue #77) the primary click-to-seek
// surface.
//
// Before #77 the ONLY way to move the playhead on the timeline was to grab the
// 2px Playhead bar and drag it relative to its current spot — every pro editor
// (剪映/Premiere/Final Cut/Descript) lets you click anywhere on the ruler to
// jump the playhead there, plus drag to scrub. This component now owns that
// gesture: pointerdown seeks to the clicked time and captures the pointer so a
// continued drag scrubs. We deliberately do NOT seek on track-body clicks —
// those belong to clip selection/drag, and hijacking them is the wrong default.
//
// Extracted from Timeline/index.tsx (was a local function) so the seek logic is
// unit-testable in isolation, mirroring Playhead.tsx.
import { useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/i18n/useT";
import { useComposition } from "../../store";
import { TIMELINE_HEADER_WIDTH, TIMELINE_RULER_HEIGHT } from "./timelineMetrics";
import { computeRulerScale } from "./timelineScale";

interface RulerProps {
  duration: number;
  pxPerSecond: number;
  totalWidth: number;
  fps: number;
}

export function Ruler({ duration, pxPerSecond, totalWidth, fps }: RulerProps) {
  const t = useT();
  // S1 (PRD-0013) — publish a seek intent so PreviewPanel drives the Player.
  const requestSeekFrame = useComposition((s) => s.requestSeekFrame);
  const containerRef = useRef<HTMLDivElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const [viewport, setViewport] = useState({ start: 0, end: duration });

  useLayoutEffect(() => {
    const scrollElement = containerRef.current?.parentElement;
    if (!scrollElement || pxPerSecond <= 0) return;

    const updateViewport = () => {
      const viewportWidth = Math.max(0, scrollElement.clientWidth - TIMELINE_HEADER_WIDTH);
      if (viewportWidth === 0) {
        setViewport({ start: 0, end: duration });
        return;
      }
      setViewport({
        start: Math.max(0, scrollElement.scrollLeft / pxPerSecond),
        end: Math.min(
          duration,
          (scrollElement.scrollLeft + viewportWidth) / pxPerSecond,
        ),
      });
    };

    updateViewport();
    scrollElement.addEventListener("scroll", updateViewport, { passive: true });
    window.addEventListener("resize", updateViewport);
    return () => {
      scrollElement.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [duration, pxPerSecond]);

  const { ticks } = computeRulerScale({
    duration,
    pxPerSecond,
    viewportStart: viewport.start,
    viewportEnd: viewport.end,
  });

  // Map a viewport clientX to a timeline frame. getBoundingClientRect already
  // accounts for horizontal scroll, so the region's left edge is always time=0.
  const seekToClientX = (clientX: number) => {
    const el = regionRef.current;
    if (!el || pxPerSecond <= 0) return;
    const rect = el.getBoundingClientRect();
    const t = Math.max(0, (clientX - rect.left) / pxPerSecond);
    requestSeekFrame(Math.round(t * fps)); // store clamps to [0, maxFrame]
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    scrubbingRef.current = true;
    seekToClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (scrubbingRef.current) seekToClientX(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    scrubbingRef.current = false;
  };

  return (
    <div
      ref={containerRef}
      style={{
        height: TIMELINE_RULER_HEIGHT,
        borderBottom: "1px solid var(--divider)",
        position: "sticky",
        top: 0,
        background: "var(--surface-1)",
        backdropFilter: "blur(24px) saturate(140%)",
        zIndex: 4,
        display: "flex",
      }}
    >
      <div
        style={{
          width: TIMELINE_HEADER_WIDTH,
          flexShrink: 0,
          borderRight: "1px solid var(--divider)",
        }}
      />
      <div
        ref={regionRef}
        data-testid="ruler-seek-region"
        role="slider"
        aria-label={t("studio.timeline.seekAria")}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          flex: 1,
          position: "relative",
          minWidth: totalWidth,
          cursor: "pointer",
          touchAction: "none",
        }}
      >
        {ticks.map((tick) => (
          <div
            key={`${tick.kind}-${tick.time}`}
            data-testid={`ruler-tick-${tick.kind}`}
            style={{
              position: "absolute",
              left: tick.time * pxPerSecond,
              bottom: 0,
              width: 1,
              height: tick.kind === "major" ? 8 : 4,
              background: "var(--divider)",
              pointerEvents: "none",
            }}
          >
            {tick.kind === "major" && (
              <span
                style={{
                  position: "absolute",
                  left: 4,
                  bottom: 9,
                  whiteSpace: "nowrap",
                  fontSize: 9,
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-dimmer)",
                  lineHeight: "12px",
                }}
              >
                {tick.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

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
import { useRef } from "react";
import { useComposition } from "../../store";

interface RulerProps {
  duration: number;
  pxPerSecond: number;
  totalWidth: number;
  fps: number;
}

export function Ruler({ duration, pxPerSecond, totalWidth, fps }: RulerProps) {
  const setFrame = useComposition((s) => s.setFrame);
  const regionRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);

  const step = duration > 60 ? 10 : duration > 20 ? 4 : 2;
  const ticks: number[] = [];
  for (let s = 0; s <= duration; s += step) ticks.push(s);

  // Map a viewport clientX to a timeline frame. getBoundingClientRect already
  // accounts for horizontal scroll, so the region's left edge is always time=0.
  const seekToClientX = (clientX: number) => {
    const el = regionRef.current;
    if (!el || pxPerSecond <= 0) return;
    const rect = el.getBoundingClientRect();
    const t = Math.max(0, (clientX - rect.left) / pxPerSecond);
    setFrame(Math.round(t * fps)); // store clamps to [0, maxFrame]
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
      style={{
        height: 22,
        borderBottom: "1px solid var(--divider)",
        position: "sticky",
        top: 0,
        background: "var(--surface-1)",
        backdropFilter: "blur(8px)",
        zIndex: 4,
        display: "flex",
      }}
    >
      <div style={{ width: 152, flexShrink: 0, borderRight: "1px solid var(--divider)" }} />
      <div
        ref={regionRef}
        data-testid="ruler-seek-region"
        role="slider"
        aria-label="Seek timeline"
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
        {ticks.map((s) => (
          <div
            key={s}
            style={{
              position: "absolute",
              left: s * pxPerSecond,
              top: 0,
              bottom: 0,
              borderLeft: "1px solid var(--divider)",
              paddingLeft: 4,
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              color: "var(--text-dimmer)",
              lineHeight: "22px",
              pointerEvents: "none", // clicks fall through to the seek region
            }}
          >
            {Math.floor(s / 60)}:{(s % 60).toString().padStart(2, "0")}
          </div>
        ))}
      </div>
    </div>
  );
}

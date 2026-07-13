import { Fragment, useEffect, useRef } from "react";
import { useComposition } from "../../store";
import { Track } from "./Track";
import { Ruler } from "./Ruler";
import { Playhead } from "./Playhead";
import { TimelineTrackHeader } from "./TimelineTrackHeader";
import { LaneGapAdd } from "./LaneGapAdd";
import { useT } from "@/i18n/useT";
import { TIMELINE_HEADER_WIDTH } from "./timelineMetrics";
import { IconButton } from "@/ui/IconButton";
import { useTimelineZoom } from "./hooks/useTimelineZoom";
import { useSplitHoverSnap } from "./hooks/useSplitHoverSnap";
import { clipDuration, clipEnd, OFFSET_EPSILON } from "@autoviral/timeline";
import type { Clip } from "../../types";
import {
  canAcceptDrop,
  dropTimeFromPointer,
  readDragPayload,
  resolveDropTime,
} from "./dnd";
import { useBeatSnap } from "../../hooks/useBeatSnap";

function formatSnapTime(time: number): string {
  const totalHundredths = Math.round(Math.max(0, time) * 100);
  const totalMinutes = Math.floor(totalHundredths / 6_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const secondHundredths = totalHundredths % 6_000;
  const seconds = Math.floor(secondHundredths / 100);
  const hundredths = secondHundredths % 100;
  const minutePrefix = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}`
    : String(minutes);
  return `${minutePrefix}:${String(seconds).padStart(2, "0")}.${String(
    hundredths,
  ).padStart(2, "0")}`;
}

function UnifiedBladeTool({
  pxPerSecond,
  totalWidth,
}: {
  pxPerSecond: number;
  totalWidth: number;
}) {
  const bladeMode = useComposition((s) => s.bladeMode);
  const comp = useComposition((s) => s.comp);
  const splitClip = useComposition((s) => s.splitClip);
  const setSnapGuide = useComposition((s) => s.setSnapGuide);
  const { snapTime, setHoverTime } = useSplitHoverSnap(pxPerSecond);
  const guideActiveRef = useRef(false);

  useEffect(() => {
    if (bladeMode) {
      guideActiveRef.current = true;
      setSnapGuide(snapTime);
    } else if (guideActiveRef.current) {
      guideActiveRef.current = false;
      setSnapGuide(null);
    }
  }, [bladeMode, setSnapGuide, snapTime]);
  useEffect(
    () => () => {
      if (guideActiveRef.current) setSnapGuide(null);
    },
    [setSnapGuide],
  );

  if (!bladeMode || !comp) return null;

  const localXFromEvent = (event: { clientX: number; currentTarget: EventTarget }) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientX - rect.left;
  };

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const raw = Math.max(0, localXFromEvent(event) / pxPerSecond);
    const time = snapTime ?? raw;
    for (const track of comp.tracks) {
      const hit = (track.clips as Clip[]).find(
        (clip) =>
          time > clip.trackOffset + OFFSET_EPSILON &&
          time < clipEnd(clip) - OFFSET_EPSILON,
      );
      if (hit) {
        splitClip(hit.id, time);
        return;
      }
    }
  };

  return (
    <div
      data-testid="blade-overlay"
      onPointerMove={(event) => {
        const x = localXFromEvent(event);
        setHoverTime(Math.max(0, x / pxPerSecond));
      }}
      onPointerLeave={() => setHoverTime(null)}
      onClick={onClick}
      style={{
        position: "absolute",
        left: TIMELINE_HEADER_WIDTH,
        top: 22,
        width: totalWidth,
        bottom: 0,
        cursor: "crosshair",
        zIndex: 6,
      }}
    />
  );
}

const TRACK_COLORS: Record<string, string> = {
  video: "var(--accent)",
  audio: "#c084fc",
  text: "var(--text-dim)",
  overlay: "#7dd3fc",
};

export function Timeline() {
  const t = useT();
  const trackLabels: Record<string, string> = {
    video: t("studio.timeline.trackLabelVideo"),
    audio: t("studio.timeline.trackLabelAudio"),
    text: t("studio.timeline.trackLabelText"),
    overlay: t("studio.timeline.trackLabelOverlay"),
  };
  const comp = useComposition((s) => s.comp);
  // 4.H — D10: snap-line overlay reads `dragState.snapTime` exposed by the
  // 4.B drag pipeline (store.ts:371-403). Renders only while a drag is active
  // AND a snap point was found.
  const dragState = useComposition((s) => s.dragState);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoom = useTimelineZoom({ duration: comp?.duration ?? 0, scrollRef });
  const beatClip = comp?.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.kind === "audio" && clip.type === "bgm");
  useBeatSnap({
    workId: comp?.workId ?? null,
    assetPath: beatClip?.kind === "audio" ? beatClip.src : null,
  });
  const pxPerSecond = zoom.pixelsPerSecond;

  if (!comp) return null;
  const totalWidth = Math.max(800, comp.duration * pxPerSecond);

  const updateNativeDropGuide = (event: React.DragEvent<HTMLDivElement>) => {
    const lane = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-track-id]",
    );
    const payload = readDragPayload(event.dataTransfer);
    const state = useComposition.getState();
    const targetTrack = state.comp?.tracks.find(
      (track) => track.id === lane?.dataset.trackId,
    );
    if (!lane || !payload || !targetTrack || !canAcceptDrop(payload, targetTrack.kind)) {
      state.setSnapGuide(null);
      return;
    }

    let duration = 5;
    let excludeClipId: string | null = null;
    if (payload.source === "clip") {
      const dragged = state.comp?.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === payload.clipId);
      if (dragged) duration = clipDuration(dragged);
      excludeClipId = payload.clipId;
    }
    const rawTime = dropTimeFromPointer(
      event.clientX,
      lane.getBoundingClientRect().left + 6,
      pxPerSecond,
    );
    const fps = state.comp?.fps || 30;
    const { snapTime } = resolveDropTime(
      state.comp,
      rawTime,
      duration,
      state.currentFrame / fps,
      excludeClipId,
      pxPerSecond,
      state.beats,
    );
    state.setSnapGuide(snapTime);
  };

  return (
    <div
      data-timeline-unified-snap="true"
      style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}
    >
      <style>{`[data-timeline-unified-snap="true"] [data-testid="drop-indicator"] { display: none !important; }`}</style>
      {/* Toolbar */}
      <div
        style={{
          padding: "8px 14px",
          borderBottom: "1px solid var(--divider)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {t("studio.timeline.title")}
        </span>
        <div style={{ width: 1, height: 14, background: "var(--divider)" }} />
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dimmer)",
          }}
        >
          {comp.duration.toFixed(2)}s
        </span>
        <div style={{ flex: 1 }} />
        <IconButton
          onClick={zoom.zoomOut}
          size="sm"
          variant="surface"
          aria-label={t("studio.timeline.zoomOutAria")}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7h8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </IconButton>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={zoom.sliderPosition}
          onChange={(event) => zoom.setSliderPosition(Number(event.currentTarget.value))}
          aria-label={t("studio.timeline.zoomSliderAria")}
          aria-valuetext={t("studio.timeline.zoomValue", { value: Math.round(pxPerSecond) })}
          style={{ width: 88, accentColor: "var(--accent)" }}
        />
        <span
          role="button"
          tabIndex={0}
          aria-label={t("studio.timeline.zoomBadgeAria", { value: Math.round(pxPerSecond) })}
          onDoubleClick={zoom.fit}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") zoom.fit();
          }}
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
            minWidth: 64,
            textAlign: "center",
            cursor: "default",
          }}
        >
          {t("studio.timeline.zoomValue", { value: Math.round(pxPerSecond) })}
        </span>
        <IconButton
          onClick={zoom.zoomIn}
          size="sm"
          variant="surface"
          aria-label={t("studio.timeline.zoomInAria")}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7h8M7 3v8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </IconButton>
        <button
          type="button"
          data-bare
          onClick={zoom.fit}
          aria-label={t("studio.timeline.zoomFitAria")}
          style={{
            height: 24,
            padding: "0 8px",
            border: "1px solid var(--glass-border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--glass-lo)",
            color: "var(--text-dim)",
            font: "10px var(--font-mono)",
          }}
        >
          {t("studio.timeline.zoomFit")}
        </button>
      </div>

      {/* Body: track-label column on left, scrollable lanes on right */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        {/* Lanes (label + waveform area) */}
        <div
          ref={scrollRef}
          onDragOver={updateNativeDropGuide}
          onDragLeave={(event) => {
            const next = event.relatedTarget as Node | null;
            if (!next || !event.currentTarget.contains(next)) {
              useComposition.getState().setSnapGuide(null);
            }
          }}
          onDrop={() => useComposition.getState().setSnapGuide(null)}
          style={{ flex: 1, overflow: "auto", position: "relative" }}
        >
          {/* Ruler */}
          <Ruler duration={comp.duration} pxPerSecond={pxPerSecond} totalWidth={totalWidth} fps={comp.fps} />
          {/* Tracks — Phase F (issue #33). Sort by displayOrder so the visual
              order tracks the schema invariant; render TimelineTrackHeader
              as a sibling of Track (sitting in the same 110px sticky-left
              slot but at a higher z-index so it covers Track's internal
              label cell). LaneGapAdd buttons sit between adjacent rows,
              plus a leading gap above the first row and a trailing gap
              below the last for symmetric add affordance. */}
          {(() => {
            const sortedTracks = [...comp.tracks].sort(
              (a, b) => a.displayOrder - b.displayOrder,
            );
            return sortedTracks.map((track, i) => {
              const compact = track.kind === "text";
              const height = compact ? 44 : 56;
              const fallback = trackLabels[track.kind] ?? track.kind.toUpperCase();
              return (
                <Fragment key={track.id}>
                  {i === 0 && (
                    // Leading gap — lets the user add a row above tracks[0]
                    // without having to right-click the existing top header.
                    <LaneGapAdd lowerTrackId={track.id} />
                  )}
                  <div style={{ position: "relative", display: "flex" }}>
                    {/* TimelineTrackHeader owns the 110px sticky-left label
                        slot; Track is rendered with hideLabel=true so it
                        skips its own label cell (no overlap). */}
                    <div
                      style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 4,
                        display: "flex",
                        alignItems: "stretch",
                      }}
                    >
                      <TimelineTrackHeader
                        track={track}
                        fallbackLabel={fallback}
                        height={height}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Track
                        track={track}
                        pxPerSecond={pxPerSecond}
                        totalWidth={totalWidth}
                        color={TRACK_COLORS[track.kind] ?? "var(--accent)"}
                        label={fallback}
                        hideLabel
                      />
                    </div>
                  </div>
                  <LaneGapAdd
                    upperTrackId={track.id}
                    lowerTrackId={sortedTracks[i + 1]?.id}
                  />
                </Fragment>
              );
            });
          })()}
          {/* Phase 4.G — click-to-split overlay; renders only while
              bladeMode is on. 4.J wires `B` / `Cmd+B` to toggle. */}
          <UnifiedBladeTool
            pxPerSecond={pxPerSecond}
            totalWidth={totalWidth}
          />
          {/* Phase 4.H — Playhead + snap-line overlays.
              D5: Playhead is a sibling of <Ruler /> mounted full-height
              within the lanes container, offset by the 110px label column
              at the parent level. The wrapper itself is pointer-events:none
              so it doesn't intercept clip drags below; Playhead re-enables
              pointer events on its own hit area.
              D10: snap-line is a separate vertical overlay driven by
              `dragState.snapTime` (4.B store output). */}
          <div
            data-testid="playhead-overlay"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: TIMELINE_HEADER_WIDTH,
              right: 0,
              pointerEvents: "none",
              zIndex: 6,
            }}
          >
            <Playhead pxPerSecond={pxPerSecond} fps={comp.fps} />
            {dragState && dragState.snapTime != null && (
              <div
                data-testid="snap-line"
                role="status"
                aria-label={t("studio.timeline.snapGuideAria", {
                  time: formatSnapTime(dragState.snapTime),
                })}
                style={{
                  position: "absolute",
                  left: dragState.snapTime * pxPerSecond,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: "var(--accent-hi)",
                  boxShadow: "0 0 8px var(--accent-hi)",
                  pointerEvents: "none",
                  zIndex: 6,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: 2,
                    left: "50%",
                    width: 4,
                    height: 4,
                    background: "var(--accent-hi)",
                    transform: "translateX(-50%) rotate(45deg)",
                  }}
                />
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: 7,
                    left: 6,
                    padding: "1px 5px",
                    border: "1px solid var(--glass-border)",
                    borderRadius: 4,
                    background: "var(--glass-hi)",
                    backdropFilter: "blur(12px)",
                    color: "var(--text)",
                    font: "9px/14px var(--font-mono)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatSnapTime(dragState.snapTime)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

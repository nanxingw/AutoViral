import { Fragment, useState } from "react";
import { useComposition } from "../../store";
import { Track } from "./Track";
import { Ruler } from "./Ruler";
import { BladeTool } from "./BladeTool";
import { Playhead } from "./Playhead";
import { TimelineTrackHeader } from "./TimelineTrackHeader";
import { LaneGapAdd } from "./LaneGapAdd";
import { useT } from "@/i18n/useT";

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
  const [zoom, setZoom] = useState(1.2);
  const pxPerSecond = 50 * zoom;

  if (!comp) return null;
  const totalWidth = Math.max(800, comp.duration * pxPerSecond);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
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
        <button
          type="button"
          data-bare
          onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}
          style={iconBtn()}
          aria-label="Zoom out"
        >
          −
        </button>
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
            minWidth: 36,
            textAlign: "center",
          }}
        >
          {zoom.toFixed(1)}×
        </span>
        <button
          type="button"
          data-bare
          onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
          style={iconBtn()}
          aria-label="Zoom in"
        >
          +
        </button>
      </div>

      {/* Body: track-label column on left, scrollable lanes on right */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        {/* Lanes (label + waveform area) */}
        <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
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
          <BladeTool
            pxPerSecond={pxPerSecond}
            totalWidth={totalWidth}
            labelColumnWidth={152}
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
              left: 152,
              right: 0,
              pointerEvents: "none",
              zIndex: 6,
            }}
          >
            <Playhead pxPerSecond={pxPerSecond} fps={comp.fps} />
            {dragState && dragState.snapTime != null && (
              <div
                data-testid="snap-line"
                style={{
                  position: "absolute",
                  left: dragState.snapTime * pxPerSecond,
                  top: 22, // below the 22px ruler
                  bottom: 0,
                  width: 1,
                  background: "var(--accent-hi)",
                  boxShadow: "0 0 8px var(--accent-hi)",
                  pointerEvents: "none",
                  zIndex: 6,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function iconBtn(): React.CSSProperties {
  return {
    width: 26,
    height: 26,
    borderRadius: 6,
    border: "1px solid var(--glass-border)",
    background: "var(--surface-0)",
    color: "var(--text-dim)",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1,
  };
}

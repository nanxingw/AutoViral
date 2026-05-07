import type { ReactElement } from "react";
import { Clip } from "./Clip";
import { Filmstrip } from "./Filmstrip";
import { WaveformBars } from "./WaveformBars";
import type { Track as TrackType } from "../../types";

interface Props {
  track: TrackType;
  pxPerSecond: number;
  totalWidth: number;
  color: string;
  label: string;
}

const KIND_ICON: Record<string, ReactElement> = {
  video: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M22 8l-6 4 6 4V8z" />
    </svg>
  ),
  audio: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  text: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  overlay: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
};

export function Track({ track, pxPerSecond, totalWidth, color, label }: Props) {
  const compact = track.kind === "text";
  const height = compact ? 36 : 56;
  return (
    <div
      data-kind={track.kind}
      style={{
        display: "flex",
        borderBottom: "1px solid var(--divider)",
        minHeight: height,
      }}
    >
      {/* Label column (sticky-ish) */}
      <div
        style={{
          width: 110,
          flexShrink: 0,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderRight: "1px solid var(--divider)",
          background: "var(--surface-0)",
          position: "sticky",
          left: 0,
          zIndex: 3,
        }}
      >
        <span style={{ color, display: "grid", placeItems: "center" }}>
          {KIND_ICON[track.kind] ?? KIND_ICON.video}
        </span>
        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-dim)" }}>
          {label}
        </span>
      </div>

      {/* Clip lane */}
      <div
        style={{
          flex: 1,
          padding: 6,
          position: "relative",
          minWidth: totalWidth,
          height,
        }}
      >
        {/* Phase 4.D — filmstrip overlays render BENEATH the clip overlay
            (rendered first so the Clip header/handles z-index above them). */}
        {track.kind === "video" &&
          track.clips.map((c) =>
            c.kind === "video" ? (
              <div
                key={`fs-${c.id}`}
                style={{
                  position: "absolute",
                  left: c.trackOffset * pxPerSecond,
                  top: 4,
                  height: height - 8,
                  pointerEvents: "none",
                }}
              >
                <Filmstrip
                  clip={c}
                  pxPerSecond={pxPerSecond}
                  height={height - 8}
                />
              </div>
            ) : null,
          )}
        {/* Phase 4.E — waveform overlays beneath audio clips. Same
            mounting pattern as the filmstrip overlay above. */}
        {track.kind === "audio" &&
          track.clips.map((c) =>
            c.kind === "audio" ? (
              <div
                key={`wf-${c.id}`}
                style={{
                  position: "absolute",
                  left: c.trackOffset * pxPerSecond,
                  top: 4,
                  height: height - 8,
                  pointerEvents: "none",
                }}
              >
                <WaveformBars
                  clip={c}
                  pxPerSecond={pxPerSecond}
                  height={height - 8}
                />
              </div>
            ) : null,
          )}
        {track.clips.map((c) => (
          <Clip
            key={c.id}
            clipId={c.id}
            pxPerSecond={pxPerSecond}
            trackKind={track.kind}
            color={color}
          />
        ))}
      </div>
    </div>
  );
}

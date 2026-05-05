import { useState } from "react";
import { useComposition } from "../../store";
import { Track } from "./Track";

const TRACK_COLORS: Record<string, string> = {
  video: "var(--accent)",
  audio: "#c084fc",
  text: "var(--text-dim)",
  overlay: "#7dd3fc",
};

const TRACK_LABELS: Record<string, string> = {
  video: "视频 · Video",
  audio: "BGM · Music",
  text: "字幕 · Subs",
  overlay: "覆盖 · FX",
};

export function Timeline() {
  const comp = useComposition((s) => s.comp);
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
          Timeline
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
          <Ruler duration={comp.duration} pxPerSecond={pxPerSecond} totalWidth={totalWidth} />
          {/* Tracks */}
          {comp.tracks.map((t) => (
            <Track
              key={t.id}
              track={t}
              pxPerSecond={pxPerSecond}
              totalWidth={totalWidth}
              color={TRACK_COLORS[t.kind] ?? "var(--accent)"}
              label={TRACK_LABELS[t.kind] ?? t.kind.toUpperCase()}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Ruler({
  duration,
  pxPerSecond,
  totalWidth,
}: {
  duration: number;
  pxPerSecond: number;
  totalWidth: number;
}) {
  const step = duration > 60 ? 10 : duration > 20 ? 4 : 2;
  const ticks: number[] = [];
  for (let s = 0; s <= duration; s += step) ticks.push(s);

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
      <div style={{ width: 110, flexShrink: 0, borderRight: "1px solid var(--divider)" }} />
      <div style={{ flex: 1, position: "relative", minWidth: totalWidth }}>
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
            }}
          >
            {Math.floor(s / 60)}:{(s % 60).toString().padStart(2, "0")}
          </div>
        ))}
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

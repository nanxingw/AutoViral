import { useComposition } from "../../store";
import { snapToBeat } from "./snapToBeat";
import clsx from "clsx";

function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function Clip({
  clipId,
  pxPerSecond,
  trackKind,
  color: _color,
}: {
  clipId: string;
  pxPerSecond: number;
  trackKind: "video" | "audio" | "text" | "overlay";
  color: string;
}) {
  const clip = useComposition((s) =>
    s.comp?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId),
  );
  const selection = useComposition((s) => s.selection);
  const setSelection = useComposition((s) => s.setSelection);
  const updateClip = useComposition((s) => s.updateClip);
  if (!clip) return null;

  const dur = "duration" in clip ? clip.duration : clip.out - clip.in;
  const left = clip.trackOffset * pxPerSecond;
  const width = dur * pxPerSecond;
  const isSelected = selection === clipId;
  const isLight =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setSelection(clipId);
    const startX = e.clientX;
    const startOffset = clip.trackOffset;
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) / pxPerSecond;
      const raw = Math.max(0, startOffset + delta);
      const grid = Math.round(raw * 10) / 10;
      const beats = useComposition.getState().beats;
      const snapped = snapToBeat(grid, beats, 0.06);
      updateClip(clipId, { trackOffset: snapped });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const label =
    clip.kind === "text"
      ? clip.text.slice(0, 24)
      : clip.kind === "video" || clip.kind === "audio"
      ? clip.src.split("/").pop()?.replace(/\.[^.]+$/, "").slice(0, 18) ?? clipId
      : clipId;

  let background: string;
  let borderColor: string;
  let fg: string;
  let fgDim: string;

  if (trackKind === "video") {
    const hue = hueFromString(clip.id);
    background = isLight
      ? `linear-gradient(135deg, hsl(${hue}, 35%, 82%), hsl(${(hue + 20) % 360}, 40%, 72%))`
      : `linear-gradient(135deg, hsl(${hue}, 30%, 30%), hsl(${(hue + 20) % 360}, 35%, 20%))`;
    borderColor = "rgba(128,128,128,0.15)";
    fg = isLight ? "rgba(15,24,34,0.88)" : "rgba(255,255,255,0.92)";
    fgDim = isLight ? "rgba(15,24,34,0.5)" : "rgba(255,255,255,0.6)";
  } else if (trackKind === "audio") {
    background = "linear-gradient(90deg, rgba(192,132,252,0.15), rgba(192,132,252,0.1))";
    borderColor = "rgba(192,132,252,0.25)";
    fg = "#c084fc";
    fgDim = "rgba(192,132,252,0.6)";
  } else if (trackKind === "text") {
    background = "var(--glass-hi)";
    borderColor = "var(--glass-border)";
    fg = "var(--text)";
    fgDim = "var(--text-dim)";
  } else {
    background = "rgba(125,211,252,0.12)";
    borderColor = "rgba(125,211,252,0.25)";
    fg = "#7dd3fc";
    fgDim = "rgba(125,211,252,0.6)";
  }

  if (isSelected) {
    borderColor = "var(--accent)";
  }

  return (
    <div
      className={clsx("timeline-clip", clip.kind, isSelected && "selected")}
      style={{
        position: "absolute",
        left,
        width: Math.max(width, 24),
        top: 4,
        bottom: 4,
        background,
        border: `1px solid ${borderColor}`,
        borderRadius: 6,
        padding: "4px 6px",
        cursor: "grab",
        overflow: "hidden",
        boxShadow: isSelected ? "0 0 12px var(--accent-glow)" : "none",
        transition: "box-shadow 0.15s",
      }}
      onPointerDown={onPointerDown}
    >
      <div
        style={{
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          color: fgDim,
          letterSpacing: "0.06em",
        }}
      >
        {dur.toFixed(1)}s
      </div>
      <div
        style={{
          fontSize: 10,
          color: fg,
          fontWeight: 500,
          marginTop: 2,
          letterSpacing: "-0.01em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
}

import { useComposition } from "../../store";
import { useClipResize } from "./hooks/useClipResize";
import clsx from "clsx";

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
  const dragState = useComposition((s) => s.dragState);
  const beginDrag = useComposition((s) => s.beginDrag);
  const updateDragCandidate = useComposition((s) => s.updateDragCandidate);
  const commitDrag = useComposition((s) => s.commitDrag);
  const cancelDrag = useComposition((s) => s.cancelDrag);
  // Phase 4.F — edge-drag resize hook. The hook is pointer-source agnostic;
  // we wire window-level pointermove/up/cancel/keydown listeners below so
  // resize works even when the cursor leaves the handle.
  const resize = useClipResize({ clipId, pxPerSecond });
  if (!clip) return null;

  const dur = "duration" in clip ? clip.duration : clip.out - clip.in;
  // Phase 4.B — render the dragState preview position when the clip is
  // mid-drag (or being cascaded by another clip's drag). Falls back to the
  // committed trackOffset otherwise.
  const previewStart = dragState?.preview.get(clipId);
  const renderedOffset = previewStart ?? clip.trackOffset;
  const left = renderedOffset * pxPerSecond;
  const width = dur * pxPerSecond;
  const isSelected = selection === clipId;
  const isLight =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setSelection(clipId);
    beginDrag(clipId);
    const startX = e.clientX;
    const startOffset = clip.trackOffset;
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) / pxPerSecond;
      const raw = Math.max(0, startOffset + delta);
      updateDragCandidate(raw);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", esc);
    };
    const up = () => {
      cleanup();
      commitDrag();
    };
    const cancel = () => {
      cleanup();
      cancelDrag();
    };
    const esc = (kev: KeyboardEvent) => {
      if (kev.key === "Escape") {
        cleanup();
        cancelDrag();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", esc);
  };

  // Phase 4.F — handles. `stopPropagation` prevents the body-drag pipeline
  // (4.B) from also firing on edge pointerdown. Window-level listeners live
  // for the duration of one drag and are torn down on pointerup/cancel.
  const onHandleDown = (edge: "left" | "right") => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    resize.beginResize(edge, e.clientX);
    const move = (ev: PointerEvent) => resize.dragResize(ev.clientX);
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
    const up = () => {
      cleanup();
      resize.endResize();
    };
    const cancel = () => {
      cleanup();
      resize.cancelResize();
    };
    const key = (kev: KeyboardEvent) => {
      if (kev.key === "Escape") {
        cleanup();
        resize.cancelResize();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
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
    // Bug 2 fix: video clip body must be transparent so the Filmstrip
    // (rendered beneath in Track.tsx) shows through. Pneuma's VideoTrack
    // (.cache/pneuma-clipcraft/.../timeline/VideoTrack.tsx:158-179) uses
    // the same pattern — the clip frame is just a border + label, the
    // thumbnails carry the visual identity. Selected state still adds a
    // subtle accent tint so the active clip is distinguishable.
    background = isSelected
      ? isLight
        ? "rgba(42,58,74,0.10)"
        : "rgba(168,197,214,0.12)"
      : "transparent";
    borderColor = "rgba(128,128,128,0.18)";
    fg = isLight ? "rgba(15,24,34,0.92)" : "rgba(255,255,255,0.95)";
    fgDim = isLight ? "rgba(15,24,34,0.55)" : "rgba(255,255,255,0.7)";
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
          // Bug 2 follow-up: video clips no longer have an opaque background
          // (the filmstrip is shown beneath), so labels need a soft shadow to
          // stay legible over thumbnails.
          textShadow:
            trackKind === "video" ? "0 1px 2px rgba(0,0,0,0.6)" : undefined,
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
          textShadow:
            trackKind === "video" ? "0 1px 2px rgba(0,0,0,0.6)" : undefined,
        }}
      >
        {label}
      </div>
      <div
        data-testid="resize-left"
        onPointerDown={onHandleDown("left")}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: -4,
          width: 8,
          cursor: "ew-resize",
          zIndex: 5,
        }}
      />
      <div
        data-testid="resize-right"
        onPointerDown={onHandleDown("right")}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: -4,
          width: 8,
          cursor: "ew-resize",
          zIndex: 5,
        }}
      />
    </div>
  );
}

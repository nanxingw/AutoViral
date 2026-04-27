import { useComposition } from "../../store";
import { snapToBeat } from "./snapToBeat";
import clsx from "clsx";

export function Clip({
  clipId,
  pxPerSecond,
}: {
  clipId: string;
  pxPerSecond: number;
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

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setSelection(clipId);
    const startX = e.clientX;
    const startOffset = clip.trackOffset;
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) / pxPerSecond;
      const raw = Math.max(0, (startOffset + delta));
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

  const label = clip.kind === "text" ? clip.text.slice(0, 18) : clip.id;

  return (
    <div
      className={clsx(
        "timeline-clip",
        clip.kind,
        selection === clipId && "selected",
      )}
      style={{
        position: "absolute",
        left,
        width,
        top: 4,
        bottom: 4,
        borderRadius: 4,
        cursor: "grab",
      }}
      onPointerDown={onPointerDown}
    >
      <span className="clip-label">{label}</span>
    </div>
  );
}

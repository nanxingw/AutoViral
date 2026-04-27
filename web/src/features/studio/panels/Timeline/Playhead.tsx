import { useComposition } from "../../store";

export function Playhead({ pxPerSecond }: { pxPerSecond: number }) {
  const frame = useComposition((s) => s.currentFrame);
  const fps = useComposition((s) => s.comp?.fps ?? 30);
  const left = (frame / fps) * pxPerSecond;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top: 0,
        bottom: 0,
        width: 1,
        background: "var(--accent)",
        pointerEvents: "none",
      }}
    />
  );
}

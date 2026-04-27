import { useEditor } from "../store";

export function AIHint() {
  const car = useEditor((s) => s.car);
  if (!car) return null;
  const lowDensity = car.slides.findIndex((s) => s.layers.length < 2);
  if (lowDensity < 0) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        left: 24,
        bottom: 24,
        padding: 12,
        background: "var(--surface-glass, rgba(250,250,247,0.92))",
        backdropFilter: "blur(8px)",
        border: "1px solid var(--border, rgba(0,0,0,0.08))",
        borderRadius: 8,
        fontSize: 12,
        maxWidth: 240,
        boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
        fontFamily: "var(--font-mono)",
        color: "var(--text-soft)",
        lineHeight: 1.5,
        zIndex: 20,
      }}
    >
      第 {lowDensity + 1} 张密度低，建议加一段引导文案或 caption。
    </div>
  );
}

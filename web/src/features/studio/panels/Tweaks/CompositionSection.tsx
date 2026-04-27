import { useComposition } from "../../store";
import { ASPECTS, FPS_VALUES, type Aspect } from "../../types";

const ASPECT_DIMS: Record<Aspect, [number, number]> = {
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "16:9": [1920, 1080],
  "4:5": [1080, 1350],
};

export function CompositionSection() {
  const comp = useComposition((s) => s.comp);
  const loadComposition = useComposition((s) => s.loadComposition);
  if (!comp) return null;

  const onFpsChange = (fps: 24 | 25 | 30 | 60) => {
    loadComposition({ ...comp, fps, updatedAt: new Date().toISOString() });
  };
  const onAspectChange = (aspect: Aspect) => {
    const [w, h] = ASPECT_DIMS[aspect];
    loadComposition({
      ...comp,
      aspect,
      width: w,
      height: h,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <section
      style={{
        padding: "12px 16px",
        borderTop: "1px solid var(--border)",
      }}
    >
      <h4
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--text-soft)",
          margin: "0 0 8px",
        }}
      >
        Composition
      </h4>
      <label
        style={{
          display: "block",
          fontSize: 11,
          color: "var(--text-soft)",
          marginBottom: 6,
        }}
      >
        FPS
        <select
          value={comp.fps}
          onChange={(e) =>
            onFpsChange(Number(e.target.value) as 24 | 25 | 30 | 60)
          }
          style={{ marginLeft: 8 }}
        >
          {FPS_VALUES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label
        style={{
          display: "block",
          fontSize: 11,
          color: "var(--text-soft)",
          marginBottom: 6,
        }}
      >
        Aspect
        <select
          value={comp.aspect}
          onChange={(e) => onAspectChange(e.target.value as Aspect)}
          style={{ marginLeft: 8 }}
        >
          {ASPECTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-soft)",
          fontFamily: "var(--font-mono)",
        }}
      >
        Duration: {comp.duration.toFixed(2)}s · {comp.width}×{comp.height}
      </div>
    </section>
  );
}

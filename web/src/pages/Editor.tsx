import { useParams } from "react-router-dom";

export default function Editor() {
  const { workId } = useParams();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr 340px",
        gridTemplateRows: "56px 1fr 124px",
        gridTemplateAreas: `"top top top" "left canvas right" "left tray right"`,
        gap: 12,
        padding: 12,
        height: "100vh",
      }}
      data-work-id={workId}
    >
      <div style={{ gridArea: "top", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>top bar</div>
      <div style={{ gridArea: "left", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>slides nav (Plan 3)</div>
      <div style={{ gridArea: "canvas", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)", display: "grid", placeItems: "center", color: "var(--text-dim)" }}>
        <div style={{ textAlign: "center" }}>
          <div className="font-editorial-italic" style={{ fontSize: 28 }}>Editor</div>
          <div className="font-mono" style={{ marginTop: 8, color: "var(--text-dimmer)" }}>workId: {workId}</div>
          <div className="font-mono" style={{ marginTop: 4, color: "var(--text-dimmer)" }}>Konva canvas · Plan 3</div>
        </div>
      </div>
      <div style={{ gridArea: "right", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>inspector (Plan 3)</div>
      <div style={{ gridArea: "tray", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>filmstrip (Plan 3)</div>
    </div>
  );
}

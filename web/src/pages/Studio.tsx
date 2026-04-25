import { useParams } from "react-router-dom";

export default function Studio() {
  const { workId } = useParams();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "360px 1fr 300px",
        gridTemplateRows: "56px 1fr 320px",
        gridTemplateAreas: `"top top top" "chat preview aside" "chat timeline aside"`,
        gap: 12,
        padding: 12,
        height: "100vh",
        maxHeight: "100vh",
      }}
      data-work-id={workId}
    >
      <div style={{ gridArea: "top", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>top bar</div>
      <div style={{ gridArea: "chat", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>chat (Plan 2)</div>
      <div style={{ gridArea: "preview", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)", display: "grid", placeItems: "center", color: "var(--text-dim)" }}>
        <PreviewPlaceholder workId={workId ?? "?"} />
      </div>
      <div style={{ gridArea: "aside", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>tweaks (Plan 2)</div>
      <div style={{ gridArea: "timeline", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>timeline (Plan 2)</div>
    </div>
  );
}

function PreviewPlaceholder({ workId }: { workId: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div className="font-editorial-italic" style={{ fontSize: 28 }}>Studio</div>
      <div className="font-mono" style={{ marginTop: 8, color: "var(--text-dimmer)" }}>workId: {workId}</div>
      <div className="font-mono" style={{ marginTop: 4, color: "var(--text-dimmer)" }}>Remotion Player · Plan 2</div>
    </div>
  );
}

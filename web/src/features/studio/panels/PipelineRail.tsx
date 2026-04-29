// PipelineRail — Studio v4.0 horizontal pipeline-stage progress rail.
// Mirrors the static visual from autoviral design/studio-app.jsx:37-79.
// Stages are hardcoded in this batch; live wiring to pipeline state is
// deferred (no upstream store exists yet — see Phase 5+).

type StageStatus = "done" | "running" | "pending";

interface Stage {
  id: string;
  zh: string;
  en: string;
  duration: string;
  status: StageStatus;
}

const STAGES: Stage[] = [
  { id: "research",   zh: "研究", en: "RESEARCH",   duration: "1m 12s", status: "done" },
  { id: "scripting",  zh: "脚本", en: "SCRIPTING",  duration: "2m 04s", status: "done" },
  { id: "generation", zh: "生成", en: "GENERATION", duration: "5m 32s", status: "running" },
  { id: "editing",    zh: "剪辑", en: "EDITING",    duration: "—",       status: "pending" },
  { id: "loudness",   zh: "响度", en: "LOUDNESS",   duration: "—",       status: "pending" },
];

export function PipelineRail() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "10px 14px",
        whiteSpace: "nowrap",
        overflowX: "auto",
        height: "100%",
      }}
    >
      {STAGES.map((step, i) => (
        <div key={step.id} style={{ display: "contents" }}>
          <div
            data-testid={`rail-stage-${step.id}`}
            data-status={step.status}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "6px 12px",
              background:
                step.status === "running" ? "var(--accent-glow)" :
                step.status === "done" ? "rgba(163,230,53,0.08)" : "transparent",
              border: `1px solid ${
                step.status === "running" ? "var(--accent)" :
                step.status === "done" ? "rgba(163,230,53,0.25)" : "var(--glass-border)"
              }`,
              borderRadius: 999,
              flex: "0 0 auto",
            }}
          >
            <span
              style={{
                width: 22, height: 22, borderRadius: "50%",
                display: "grid", placeItems: "center", flexShrink: 0,
                background:
                  step.status === "done" ? "var(--status-done, #a3e635)" :
                  step.status === "running" ? "var(--accent)" : "transparent",
                border: step.status === "pending" ? "1px dashed var(--text-muted)" : "none",
                color:
                  step.status === "pending" ? "var(--text-dimmer)" : "var(--accent-fg, #0a0b0f)",
                fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
              }}
            >
              {step.status === "done" ? "✓" : (i + 1).toString().padStart(2, "0")}
            </span>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, whiteSpace: "nowrap" }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{step.zh}</span>
              <span
                style={{
                  fontSize: 9, color: "var(--text-dimmer)",
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {step.en} · {step.duration}
              </span>
            </div>
          </div>
          {i < STAGES.length - 1 && (
            <div
              style={{
                flex: "0 0 16px", height: 1,
                background: "var(--divider)", position: "relative",
              }}
            >
              {step.status === "done" && (
                <div style={{ position: "absolute", inset: 0, background: "var(--accent)", opacity: 0.4 }} />
              )}
            </div>
          )}
        </div>
      ))}
      <div style={{ flex: 1, minWidth: 16 }} />
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          fontSize: 11, color: "var(--text-dimmer)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span>TOTAL 11:54</span>
        <span>·</span>
        <span>EVAL ON</span>
      </div>
    </div>
  );
}

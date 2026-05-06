import { useState } from "react";
import { VariantSwitcher } from "./VariantSwitcher";
import { DiveCanvas } from "../../dive/DiveCanvas";

export function InspectorTab() {
  const [diveOpen, setDiveOpen] = useState(false);

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: 14,
          height: "100%",
          overflow: "auto",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-editorial)",
            fontSize: 18,
            fontStyle: "italic",
            letterSpacing: "-0.015em",
            color: "var(--text)",
          }}
        >
          Inspector
        </div>
        <VariantSwitcher />
        <button
          type="button"
          onClick={() => setDiveOpen(true)}
          style={{
            padding: "8px 12px",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em",
            border: "1px solid var(--glass-border)",
            background: "var(--surface-0)",
            color: "var(--text-dim)",
            borderRadius: 6,
            cursor: "pointer",
            alignSelf: "flex-start",
          }}
        >
          Open in Dive
        </button>
      </div>
      <DiveCanvas open={diveOpen} onClose={() => setDiveOpen(false)} />
    </>
  );
}

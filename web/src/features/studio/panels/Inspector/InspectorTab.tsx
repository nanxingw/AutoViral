import { useState } from "react";
import { VariantSwitcher } from "./VariantSwitcher";
import { ClipTrackSelect } from "./ClipTrackSelect";
import { KeyframePanel } from "./KeyframePanel";
import { TextClipPanel } from "./TextClipPanel";
import { StaticPropsPanel } from "./StaticPropsPanel";
import { DiveCanvas } from "../../dive/DiveCanvas";
import { useT } from "@/i18n/useT";

export function InspectorTab() {
  const [diveOpen, setDiveOpen] = useState(false);
  const t = useT();

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
          {t("studio.inspector.header")}
        </div>
        <VariantSwitcher />
        {/* #88 — move the selected clip to another same-kind lane (renders
            for every clip kind, above the kind-specific panels). */}
        <ClipTrackSelect />
        <TextClipPanel />
        {/* #56 — static transform/opacity/filter/volume controls.
            Sits above KeyframePanel: static value is the no-keyframes
            baseline; keyframes layer animation on top of it. */}
        <StaticPropsPanel />
        <KeyframePanel />
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
          {t("studio.inspector.btnOpenDive")}
        </button>
      </div>
      <DiveCanvas open={diveOpen} onClose={() => setDiveOpen(false)} />
    </>
  );
}

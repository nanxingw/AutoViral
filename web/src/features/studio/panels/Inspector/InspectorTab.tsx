import { VariantSwitcher } from "./VariantSwitcher";
import { ClipTrackSelect } from "./ClipTrackSelect";
import { KeyframePanel } from "./KeyframePanel";
import { TextClipPanel } from "./TextClipPanel";
import { StaticPropsPanel } from "./StaticPropsPanel";
import { TransitionPanel } from "./TransitionPanel";
import { useT } from "@/i18n/useT";

export function InspectorTab() {
  const t = useT();

  return (
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
      {/* #54 Phase 2 — transition between this video clip and the next.
          Renders only for a video clip that has a successor on its lane. */}
      <TransitionPanel />
      {/* B6 (PRD-0010) — the "Open in Dive" trigger moved from here up to the
          Studio top bar (whole-composition view is a first-class surface now). */}
    </div>
  );
}

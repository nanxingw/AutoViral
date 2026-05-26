import { useMemo } from "react";
import { useComposition } from "../../store";
import type { Clip } from "../../types";
import { useT } from "@/i18n/useT";

// #56 — static property controls. The schema (transforms/filters/opacity/
// volume) and the preview renderer (toCssFilter, transform style) were
// already wired end-to-end; only the editing UI was missing. This panel
// is the last-mile wiring.
//
// Scope: static fields only. Keyframe animation lives in KeyframePanel —
// we deliberately do NOT show speed here (it has no static field; 1.0 is
// the no-keyframes baseline per KeyframePanel.tsx:41-43) so the two
// panels don't fight over the same control.

type Section = {
  title: string;
  rows: Row[];
};
type Row = {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange: (next: number) => void;
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  paddingTop: 12,
  borderTop: "1px solid var(--divider)",
};

const sectionHeader: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "70px 1fr 60px 18px",
  alignItems: "center",
  gap: 8,
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.04em",
  color: "var(--text-dim)",
};

const numberInputStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  padding: "3px 6px",
  background: "var(--surface-0)",
  border: "1px solid var(--glass-border)",
  borderRadius: 6,
  color: "var(--text)",
  width: "100%",
  textAlign: "right",
};

const sliderStyle: React.CSSProperties = {
  width: "100%",
  accentColor: "var(--accent)",
};

const resetBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  width: 18,
  height: 18,
  padding: 0,
  background: "transparent",
  border: "1px solid var(--glass-border)",
  borderRadius: 4,
  color: "var(--text-dimmer)",
  cursor: "pointer",
  lineHeight: 1,
};

function PropRow({
  row,
  resetAriaTpl,
}: {
  row: Row;
  resetAriaTpl: (prop: string) => string;
}) {
  return (
    <div style={rowStyle}>
      <label htmlFor={`prop-${row.key}`} style={labelStyle}>
        {row.label}
      </label>
      <input
        id={`prop-${row.key}-slider`}
        type="range"
        min={row.min}
        max={row.max}
        step={row.step}
        value={row.value}
        onChange={(e) => row.onChange(parseFloat(e.target.value))}
        style={sliderStyle}
        aria-label={row.label}
      />
      <input
        id={`prop-${row.key}`}
        type="number"
        min={row.min}
        max={row.max}
        step={row.step}
        value={Number.isFinite(row.value) ? Number(row.value.toFixed(3)) : 0}
        onChange={(e) => {
          const raw = parseFloat(e.target.value);
          if (Number.isNaN(raw)) return;
          // Clamp to schema bounds at the edit site — server-side zod also
          // enforces but the slider stays in sync visually.
          const clamped = Math.min(row.max, Math.max(row.min, raw));
          row.onChange(clamped);
        }}
        style={numberInputStyle}
      />
      <button
        type="button"
        aria-label={resetAriaTpl(row.label)}
        title={resetAriaTpl(row.label)}
        onClick={() => row.onChange(row.defaultValue)}
        style={resetBtnStyle}
      >
        ↺
      </button>
    </div>
  );
}

export function StaticPropsPanel() {
  const comp = useComposition((s) => s.comp);
  const selection = useComposition((s) => s.selection);
  const updateClip = useComposition((s) => s.updateClip);
  const t = useT();

  const clip = useMemo<Clip | null>(() => {
    if (!comp || !selection) return null;
    for (const tr of comp.tracks) {
      const c = (tr.clips as Clip[]).find((c) => c.id === selection);
      if (c) return c;
    }
    return null;
  }, [comp, selection]);

  if (!clip) return null;
  // TextClip has its own dedicated panel; audio has only volume — let the
  // section list below decide what to show.
  if (clip.kind === "text") return null;

  const sections: Section[] = [];

  // Transform + Adjust — VideoClip is the only kind with static
  // `transforms` and `filters` fields (composition.ts:VideoClipObjectSchema).
  // OverlayClip uses `position`/`opacity` (no transforms/filters), so its
  // Transform UI is opacity-only here; scale/x/y/rotation for overlays
  // is keyframe-only and lives in KeyframePanel.
  if (clip.kind === "video") {
    const tx = clip.transforms;
    const setTransforms = (patch: Partial<typeof tx>) =>
      updateClip(clip.id, { transforms: { ...tx, ...patch } });
    sections.push({
      title: t("studio.inspector.sectionTransform"),
      rows: [
        {
          key: "scale",
          label: t("studio.inspector.propScale"),
          value: tx.scale,
          min: 0.1,
          max: 5,
          step: 0.01,
          defaultValue: 1,
          onChange: (v) => setTransforms({ scale: v }),
        },
        {
          key: "x",
          label: t("studio.inspector.propX"),
          value: tx.x,
          min: -1000,
          max: 1000,
          step: 1,
          defaultValue: 0,
          onChange: (v) => setTransforms({ x: v }),
        },
        {
          key: "y",
          label: t("studio.inspector.propY"),
          value: tx.y,
          min: -1000,
          max: 1000,
          step: 1,
          defaultValue: 0,
          onChange: (v) => setTransforms({ y: v }),
        },
        {
          key: "rotation",
          label: t("studio.inspector.propRotation"),
          value: tx.rotation,
          min: -360,
          max: 360,
          step: 0.5,
          defaultValue: 0,
          onChange: (v) => setTransforms({ rotation: v }),
        },
      ],
    });

    // Adjust (color) — schema bounds -1..1 (composition.ts:18-20).
    const fl = clip.filters;
    const setFilters = (patch: Partial<typeof fl>) =>
      updateClip(clip.id, { filters: { ...fl, ...patch } });
    sections.push({
      title: t("studio.inspector.sectionAdjust"),
      rows: [
        {
          key: "brightness",
          label: t("studio.inspector.propBrightness"),
          value: fl.brightness,
          min: -1,
          max: 1,
          step: 0.01,
          defaultValue: 0,
          onChange: (v) => setFilters({ brightness: v }),
        },
        {
          key: "contrast",
          label: t("studio.inspector.propContrast"),
          value: fl.contrast,
          min: -1,
          max: 1,
          step: 0.01,
          defaultValue: 0,
          onChange: (v) => setFilters({ contrast: v }),
        },
        {
          key: "saturation",
          label: t("studio.inspector.propSaturation"),
          value: fl.saturation,
          min: -1,
          max: 1,
          step: 0.01,
          defaultValue: 0,
          onChange: (v) => setFilters({ saturation: v }),
        },
      ],
    });
  }

  // Overlay — opacity is the only static field beyond position. Position
  // editing surface is out of scope for #56 (deserves its own canvas-handle
  // design pass; numeric % inputs would feel wrong for what's a spatial op).
  if (clip.kind === "overlay") {
    sections.push({
      title: t("studio.inspector.sectionTransform"),
      rows: [
        {
          key: "opacity",
          label: t("studio.inspector.propOpacity"),
          value: clip.opacity,
          min: 0,
          max: 1,
          step: 0.01,
          defaultValue: 1,
          onChange: (v) => updateClip(clip.id, { opacity: v }),
        },
      ],
    });
  }

  // Audio — volume only here (fade/ducking/type are different design
  // surfaces and out of scope for #56). Bounds from AudioClip schema
  // (composition.ts:174): 0..1.5.
  if (clip.kind === "audio") {
    sections.push({
      title: t("studio.inspector.sectionAudio"),
      rows: [
        {
          key: "volume",
          label: t("studio.inspector.propVolume"),
          value: clip.volume,
          min: 0,
          max: 1.5,
          step: 0.01,
          defaultValue: 1,
          onChange: (v) => updateClip(clip.id, { volume: v }),
        },
      ],
    });
  }

  if (sections.length === 0) return null;

  const resetAriaTpl = (prop: string) =>
    t("studio.inspector.resetAria", { prop });

  return (
    <div
      data-testid="static-props-panel"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {sections.map((sec) => (
        <div key={sec.title} style={sectionStyle}>
          <div style={sectionHeader}>{sec.title}</div>
          {sec.rows.map((row) => (
            <PropRow key={row.key} row={row} resetAriaTpl={resetAriaTpl} />
          ))}
        </div>
      ))}
    </div>
  );
}

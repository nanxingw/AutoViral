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

  // Audio — volume + fade in/out as numeric rows (#87). Bounds from the
  // AudioClip schema (composition.ts:175-177): volume 0..1.5, fade ≥0
  // (seconds — capped at 10s here, a sane editing ceiling; the schema has
  // no upper bound). `type` (select) and `ducking` (toggle + ratio) are
  // not numeric Rows, so they render in a dedicated block below. All three
  // are consumed by compositionToMixTracks (render-pipeline.ts:285-296).
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
        {
          key: "fadeIn",
          label: t("studio.inspector.propFadeIn"),
          value: clip.fadeIn ?? 0,
          min: 0,
          max: 10,
          step: 0.1,
          defaultValue: 0,
          onChange: (v) => updateClip(clip.id, { fadeIn: v }),
        },
        {
          key: "fadeOut",
          label: t("studio.inspector.propFadeOut"),
          value: clip.fadeOut ?? 0,
          min: 0,
          max: 10,
          step: 0.1,
          defaultValue: 0,
          onChange: (v) => updateClip(clip.id, { fadeOut: v }),
        },
      ],
    });
  }

  // Non-numeric audio controls that don't fit the numeric Row model:
  // `type` (enum select) drives mix routing + ducking trigger detection,
  // `ducking` is an optional sidechain config. Both are real render inputs
  // (render-pipeline.ts:285,291). NOTE: the schema's ducking carries
  // attack+release too, but compositionToMixTracks forwards ONLY `ratio`
  // (render-pipeline.ts:244-246 — "MixTrack doesn't model" them). Surfacing
  // attack/release sliders would be a silent leak (user edits → render
  // ignores), so we expose ratio only and seed attack/release with sane
  // defaults to satisfy the (required) schema fields.
  const audioClip = clip.kind === "audio" ? clip : null;

  if (sections.length === 0 && !audioClip) return null;

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

      {audioClip && (
        <div style={sectionStyle}>
          <div style={rowStyle}>
            <label htmlFor="audio-type" style={labelStyle}>
              {t("studio.inspector.audioType")}
            </label>
            <select
              id="audio-type"
              aria-label={t("studio.inspector.audioType")}
              value={audioClip.type ?? "bgm"}
              onChange={(e) =>
                updateClip(audioClip.id, {
                  type: e.target.value as typeof audioClip.type,
                })
              }
              style={{ ...numberInputStyle, gridColumn: "2 / span 3", textAlign: "left" }}
            >
              <option value="original">{t("studio.inspector.audioTypeOriginal")}</option>
              <option value="bgm">{t("studio.inspector.audioTypeBgm")}</option>
              <option value="voiceover">{t("studio.inspector.audioTypeVoiceover")}</option>
              <option value="sfx">{t("studio.inspector.audioTypeSfx")}</option>
            </select>
          </div>

          <div style={rowStyle}>
            <label htmlFor="audio-ducking" style={labelStyle}>
              {t("studio.inspector.ducking")}
            </label>
            <input
              id="audio-ducking"
              type="checkbox"
              aria-label={t("studio.inspector.ducking")}
              checked={!!audioClip.ducking}
              onChange={(e) =>
                updateClip(audioClip.id, {
                  // Enabling seeds the full schema-required shape; only
                  // `ratio` reaches render today (see note above).
                  ducking: e.target.checked
                    ? { ratio: 4, attack: 200, release: 1000 }
                    : undefined,
                })
              }
              style={{ justifySelf: "start", width: 16, height: 16, accentColor: "var(--accent)" }}
            />
          </div>

          {audioClip.ducking && (
            <>
              <PropRow
                row={{
                  key: "duckingRatio",
                  label: t("studio.inspector.duckingRatio"),
                  value: audioClip.ducking.ratio,
                  min: 1,
                  max: 20,
                  step: 0.5,
                  defaultValue: 4,
                  onChange: (v) =>
                    updateClip(audioClip.id, {
                      ducking: { ...audioClip.ducking!, ratio: v },
                    }),
                }}
                resetAriaTpl={resetAriaTpl}
              />
              <div style={{ ...labelStyle, gridColumn: "1 / -1", color: "var(--text-dimmer)" }}>
                {t("studio.inspector.duckingHint")}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

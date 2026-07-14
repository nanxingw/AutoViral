import { useMemo } from "react";
import { useComposition } from "../../store";
import type { Clip } from "../../types";
import { resolveSourceAudio } from "../../types";
import { TRANSITION_PRESETS } from "@shared/transitions";
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
  const detachClipAudio = useComposition((s) => s.detachClipAudio);
  const reattachClipAudio = useComposition((s) => s.reattachClipAudio);
  const setClipTransitionIn = useComposition((s) => s.setClipTransitionIn);
  const setClipMask = useComposition((s) => s.setClipMask);
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

  // S5 (PRD-0014) — source-audio controls for a VideoClip: a switch (mute the
  // clip's own audio), a volume slider (while enabled), and a Detach button that
  // pulls the source onto its own audio lane via the shared op. `updateClip`
  // spread-guards the sibling field (#81/#86) so toggling doesn't wipe volume.
  const videoClip = clip.kind === "video" ? clip : null;
  const srcAudio = videoClip ? resolveSourceAudio(videoClip) : null;
  // Review fix #1 — is there an AudioClip previously detached from THIS video
  // still on a lane? If so, re-enabling the source must go through the atomic
  // reverse op (reattachClipAudio → ops.attachAudio) which deletes that twin, so
  // the source + the detached track never double-play (the禁 "detach 后源声双份出声").
  const hasDetachedTwin = !!(
    videoClip &&
    comp?.tracks.some((tr) =>
      (tr.clips as Clip[]).some(
        (c) =>
          c.kind === "audio" &&
          (c as { detachedFrom?: string }).detachedFrom === videoClip.id,
      ),
    )
  );

  if (sections.length === 0 && !audioClip && !videoClip) return null;

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

      {videoClip && srcAudio && (
        <div style={sectionStyle}>
          <div style={sectionHeader}>{t("studio.inspector.sectionSourceAudio")}</div>
          <div style={rowStyle}>
            <label htmlFor="source-audio-enabled" style={labelStyle}>
              {t("studio.inspector.sourceAudioEnabled")}
            </label>
            <input
              id="source-audio-enabled"
              type="checkbox"
              aria-label={t("studio.inspector.sourceAudioEnabled")}
              checked={srcAudio.enabled}
              onChange={(e) => {
                // Review fix #1 — re-enabling WITH a detached twin present routes
                // through the atomic reverse op so the pulled AudioClip is deleted
                // in the same mutation (no double-play). All other transitions
                // (disable, or re-enable with no twin) are a plain spread-guarded
                // enabled write.
                if (e.target.checked && hasDetachedTwin) {
                  reattachClipAudio(videoClip.id);
                } else {
                  updateClip(videoClip.id, {
                    sourceAudio: {
                      ...(videoClip.sourceAudio ?? {}),
                      enabled: e.target.checked,
                    },
                  });
                }
              }}
              style={{ justifySelf: "start", width: 16, height: 16, accentColor: "var(--accent)" }}
            />
          </div>

          {srcAudio.enabled && (
            <PropRow
              row={{
                key: "sourceAudioVolume",
                label: t("studio.inspector.propVolume"),
                value: srcAudio.volume,
                min: 0,
                max: 1.5,
                step: 0.01,
                defaultValue: 1,
                onChange: (v) =>
                  updateClip(videoClip.id, {
                    // Base on the RESOLVED source (enabled always defined) so the
                    // patch satisfies the required-`enabled` SourceAudio shape;
                    // override only volume (spread-guard keeps enabled intact).
                    sourceAudio: { ...srcAudio, volume: v },
                  }),
              }}
              resetAriaTpl={resetAriaTpl}
            />
          )}

          <button
            type="button"
            aria-label={t("studio.inspector.detachAudio")}
            title={t("studio.inspector.detachAudioHint")}
            disabled={!srcAudio.enabled}
            onClick={() => detachClipAudio(videoClip.id)}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              padding: "5px 10px",
              background: "var(--surface-0)",
              border: "1px solid var(--glass-border)",
              borderRadius: 6,
              color: srcAudio.enabled ? "var(--text)" : "var(--text-dimmer)",
              cursor: srcAudio.enabled ? "pointer" : "not-allowed",
              justifySelf: "start",
            }}
          >
            {t("studio.inspector.detachAudio")}
          </button>
        </div>
      )}

      {videoClip && (
        <div style={sectionStyle}>
          <div style={sectionHeader}>{t("studio.inspector.sectionTransitionIn")}</div>
          {/* PRD-0014 S3 — entrance transition selector. Both controls route
              through the shared `setClipTransitionIn` store action (→
              ops.setTransitionIn) so the human Inspector and `autoviral clip set
              --transition-in` converge on ONE composition. "none" clears. */}
          <div style={rowStyle}>
            <label htmlFor="transition-in-preset" style={labelStyle}>
              {t("studio.inspector.transitionInPreset")}
            </label>
            <select
              id="transition-in-preset"
              aria-label={t("studio.inspector.transitionInPreset")}
              value={videoClip.transitionIn?.preset ?? "__none__"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__none__") {
                  setClipTransitionIn(videoClip.id, null);
                } else {
                  // Keep the existing duration if the clip already had an
                  // entrance; otherwise let the op default to the preset's
                  // registry default (durationSec omitted).
                  const durationSec = videoClip.transitionIn?.durationSec;
                  setClipTransitionIn(videoClip.id, {
                    preset: v as (typeof TRANSITION_PRESETS)[number],
                    ...(durationSec !== undefined ? { durationSec } : {}),
                    ...(videoClip.transitionIn?.easing
                      ? { easing: videoClip.transitionIn.easing }
                      : {}),
                  });
                }
              }}
              style={{ ...numberInputStyle, gridColumn: "2 / span 3", textAlign: "left" }}
            >
              <option value="__none__">{t("studio.inspector.transitionInNone")}</option>
              {TRANSITION_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </div>

          {videoClip.transitionIn && (
            <div style={rowStyle}>
              <label htmlFor="transition-in-duration" style={labelStyle}>
                {t("studio.inspector.transitionInDuration")}
              </label>
              <input
                id="transition-in-duration"
                type="number"
                aria-label={t("studio.inspector.transitionInDuration")}
                min={0.05}
                max={5}
                step={0.05}
                value={videoClip.transitionIn.durationSec}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next)) return;
                  setClipTransitionIn(videoClip.id, {
                    preset: videoClip.transitionIn!.preset,
                    durationSec: next,
                    ...(videoClip.transitionIn!.easing
                      ? { easing: videoClip.transitionIn!.easing }
                      : {}),
                  });
                }}
                style={{ ...numberInputStyle, gridColumn: "3 / span 2" }}
              />
            </div>
          )}
        </div>
      )}

      {videoClip && (
        <div style={sectionStyle}>
          <div style={sectionHeader}>{t("studio.inspector.sectionMask")}</div>
          {/* PRD-0014 S13 — rect/ellipse mask controls. Every control routes
              through the shared `setClipMask` store action (→ ops.setClipMask), so
              the human Inspector and `autoviral clip mask` converge on ONE
              composition. "None" clears; spreads guard the sibling mask fields. */}
          <div style={rowStyle}>
            <label htmlFor="mask-shape" style={labelStyle}>
              {t("studio.inspector.maskShape")}
            </label>
            <select
              id="mask-shape"
              aria-label={t("studio.inspector.maskShape")}
              value={videoClip.mask?.type ?? "__none__"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__none__") {
                  setClipMask(videoClip.id, null);
                } else {
                  setClipMask(videoClip.id, {
                    ...(videoClip.mask ?? {}),
                    type: v as "rect" | "ellipse",
                  });
                }
              }}
              style={{ ...numberInputStyle, gridColumn: "2 / span 3", textAlign: "left" }}
            >
              <option value="__none__">{t("studio.inspector.maskShapeNone")}</option>
              <option value="rect">{t("studio.inspector.maskShapeRect")}</option>
              <option value="ellipse">{t("studio.inspector.maskShapeEllipse")}</option>
            </select>
          </div>

          {videoClip.mask && (
            <>
              <div style={rowStyle}>
                <label htmlFor="mask-feather" style={labelStyle}>
                  {t("studio.inspector.maskFeather")}
                </label>
                <input
                  id="mask-feather"
                  type="range"
                  aria-label={t("studio.inspector.maskFeather")}
                  min={0}
                  max={1}
                  step={0.01}
                  value={videoClip.mask.feather ?? 0}
                  onChange={(e) =>
                    setClipMask(videoClip.id, {
                      ...videoClip.mask!,
                      feather: parseFloat(e.target.value),
                    })
                  }
                  style={{ ...sliderStyle, gridColumn: "2 / span 3" }}
                />
              </div>
              <div style={rowStyle}>
                <label htmlFor="mask-inverted" style={labelStyle}>
                  {t("studio.inspector.maskInverted")}
                </label>
                <input
                  id="mask-inverted"
                  type="checkbox"
                  aria-label={t("studio.inspector.maskInverted")}
                  checked={videoClip.mask.inverted ?? false}
                  onChange={(e) =>
                    setClipMask(videoClip.id, {
                      ...videoClip.mask!,
                      inverted: e.target.checked,
                    })
                  }
                  style={{ justifySelf: "start", width: 16, height: 16, accentColor: "var(--accent)" }}
                />
              </div>
            </>
          )}

          <button
            type="button"
            aria-label={t("studio.inspector.maskLetterbox")}
            title={t("studio.inspector.maskLetterbox")}
            onClick={() => setClipMask(videoClip.id, { preset: "letterbox-2.35" })}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              padding: "5px 10px",
              background: "var(--surface-0)",
              border: "1px solid var(--glass-border)",
              borderRadius: 6,
              color: "var(--text)",
              cursor: "pointer",
              justifySelf: "start",
            }}
          >
            {t("studio.inspector.maskLetterbox")}
          </button>
        </div>
      )}

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

import { useComposition } from "../../store";
import { useT, type MessageKey } from "@/i18n/useT";
import type { VideoClip } from "../../types";
import type { Transition } from "@shared/composition";
import {
  TRANSITION_PRESETS,
  TRANSITION_PRESET_META,
  type TransitionPreset,
  type TransitionFamily,
} from "@shared/transitions";

// #54 Phase 2 — the transition PICKER. Phase 1 shipped the schema + store
// actions (addTransition / updateTransition / removeTransition) + the WYSIWYG
// renderer, but with ZERO UI callers — users could not add a transition at
// all. This panel is that missing last mile.
//
// Model: a transition lives BETWEEN the selected clip and the next clip on the
// same video track (afterClipId = selected clip). So the panel only shows when
// a video clip with a successor is selected; pick a style to add, "无转场" to
// remove. Duration is capped by the shorter adjacent clip (handles); easing
// (linear / spring / ease-in-out) is now wired in the renderer.

const EASINGS: Transition["easing"][] = ["linear", "spring", "ease-in-out"];
const EASING_KEY: Record<Transition["easing"], string> = {
  linear: "linear",
  spring: "spring",
  "ease-in-out": "easeInOut",
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
const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.04em",
  color: "var(--text-dim)",
};
const controlStyle: React.CSSProperties = {
  background: "var(--surface-0)",
  border: "1px solid var(--glass-border)",
  borderRadius: 6,
  color: "var(--text)",
  fontSize: 12,
  padding: "5px 8px",
  width: "100%",
};

export function TransitionPanel() {
  const t = useT();
  const comp = useComposition((s) => s.comp);
  const selection = useComposition((s) => s.selection);
  const addTransition = useComposition((s) => s.addTransition);
  const updateTransition = useComposition((s) => s.updateTransition);
  const removeTransition = useComposition((s) => s.removeTransition);

  if (!comp || !selection) return null;
  const track = comp.tracks.find((tr) => tr.clips.some((c) => c.id === selection));
  // Phase 1 transitions are video-only and need a successor clip to fade into.
  if (!track || track.kind !== "video") return null;
  const idx = track.clips.findIndex((c) => c.id === selection);
  if (idx < 0 || idx >= track.clips.length - 1) return null;

  const before = track.clips[idx] as VideoClip;
  const after = track.clips[idx + 1] as VideoClip;
  // A transition consumes from BOTH adjacent clips' content, so the longest it
  // can be is the shorter neighbour (store re-clamps; we cap the slider so the
  // displayed value can't claim more than the cut can afford).
  const maxDur = Math.max(0.05, Math.min(before.out - before.in, after.out - after.in));

  const existing = (track.transitions ?? []).find((tr) => tr.afterClipId === selection);

  const onPickPreset = (value: string) => {
    if (value === "") {
      if (existing) removeTransition(track.id, existing.id);
      return;
    }
    const preset = value as TransitionPreset;
    if (existing) updateTransition(track.id, existing.id, { preset });
    else addTransition(track.id, { afterClipId: selection, preset });
  };

  // Stable family order for the <optgroup>s (registry insertion order).
  const families: TransitionFamily[] = [];
  for (const p of TRANSITION_PRESETS) {
    const fam = TRANSITION_PRESET_META[p].family;
    if (!families.includes(fam)) families.push(fam);
  }

  return (
    <div style={sectionStyle} data-testid="transition-panel">
      <div style={sectionHeader}>{t("studio.transition.header")}</div>
      <div style={{ ...labelStyle, color: "var(--text-dimmer)", letterSpacing: "0.02em" }}>
        {t("studio.transition.hint")}
      </div>

      <label style={labelStyle}>{t("studio.transition.presetLabel")}</label>
      <select
        data-testid="transition-preset-select"
        aria-label={t("studio.transition.presetLabel")}
        style={controlStyle}
        value={existing?.preset ?? ""}
        onChange={(e) => onPickPreset(e.target.value)}
      >
        <option value="">{t("studio.transition.none")}</option>
        {families.map((fam) => (
          <optgroup key={fam} label={t(`studio.transition.family.${fam}` as MessageKey)}>
            {TRANSITION_PRESETS.filter(
              (p) => TRANSITION_PRESET_META[p].family === fam,
            ).map((p) => (
              <option key={p} value={p}>
                {t(`studio.transition.preset.${p}` as MessageKey)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {existing && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 56px",
              alignItems: "center",
              gap: 8,
            }}
          >
            <label style={labelStyle}>{t("studio.transition.durationLabel")}</label>
            <span
              data-testid="transition-duration-value"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-dim)",
                textAlign: "right",
              }}
            >
              {existing.durationSec.toFixed(2)}s
            </span>
          </div>
          <input
            data-testid="transition-duration-range"
            type="range"
            min={0.05}
            max={maxDur}
            step={0.05}
            value={Math.min(existing.durationSec, maxDur)}
            aria-label={t("studio.transition.durationLabel")}
            onChange={(e) =>
              updateTransition(track.id, existing.id, {
                durationSec: Number(e.currentTarget.value),
              })
            }
          />

          <label style={labelStyle}>{t("studio.transition.easingLabel")}</label>
          <select
            data-testid="transition-easing-select"
            aria-label={t("studio.transition.easingLabel")}
            style={controlStyle}
            value={existing.easing}
            onChange={(e) =>
              updateTransition(track.id, existing.id, {
                easing: e.currentTarget.value as Transition["easing"],
              })
            }
          >
            {EASINGS.map((ea) => (
              <option key={ea} value={ea}>
                {t(`studio.transition.easing.${EASING_KEY[ea]}` as MessageKey)}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

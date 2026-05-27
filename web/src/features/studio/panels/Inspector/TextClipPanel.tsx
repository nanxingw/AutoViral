import { useMemo } from "react";
import { useComposition } from "../../store";
import type { Clip, TextClip } from "../../types";
import { useT } from "@/i18n/useT";

// Editor mounted in the Inspector when the selection is a `kind: "text"`
// clip. Studio's Inspector previously had no editor for these — selecting a
// subtitle showed only "no media binding", so users could see a subtitle on
// the canvas but had no way to change it. The first cut (#58 era) exposed
// only text / size / y% / duration; #86 wires the rest of the style surface
// that TextTrackRenderer + the shared TextClipSchema already support
// (color / font / weight / italic / tracking / stroke / anchor / animation).
// Every edit flows through `updateClip` and immediately re-renders the
// preview, and every field round-trips through the shared schema so it
// survives autosave → composition.yaml → reload → render.

// Brand font stack (see CLAUDE.md Aesthetic Direction). `style.font` is a
// freeform string in the schema; we surface the three loaded families.
const FONT_OPTIONS = ["Inter", "Instrument Serif", "JetBrains Mono"] as const;
const WEIGHT_OPTIONS = [400, 500, 600, 700, 800, 900] as const;
const ANIMATION_OPTIONS = [
  "kinetic-pop",
  "typewriter",
  "slide-up",
  "fade",
] as const;

export function TextClipPanel() {
  const comp = useComposition((s) => s.comp);
  const selection = useComposition((s) => s.selection);
  const updateClip = useComposition((s) => s.updateClip);
  const t = useT();

  const selected = useMemo(() => {
    if (!comp || !selection) return null;
    for (const t of comp.tracks) {
      const c = (t.clips as Clip[]).find((c) => c.id === selection);
      if (c) return c;
    }
    return null;
  }, [comp, selection]);

  if (!selected || selected.kind !== "text") return null;
  const clip = selected as TextClip;
  const style = clip.style ?? {};

  // Every style.* edit must spread the existing style — `updateClip` does a
  // shallow `Object.assign`, so a bare `{ style: { color } }` would wipe the
  // sibling style fields.
  const patchStyle = (next: Partial<TextClip["style"]>) =>
    updateClip(clip.id, { style: { ...style, ...next } } as Partial<Clip>);

  const weightLabels: Record<number, string> = {
    400: t("studio.textClipPanel.weightRegular"),
    500: t("studio.textClipPanel.weightMedium"),
    600: t("studio.textClipPanel.weightSemibold"),
    700: t("studio.textClipPanel.weightBold"),
    800: t("studio.textClipPanel.weightExtrabold"),
    900: t("studio.textClipPanel.weightBlack"),
  };
  const animationLabels: Record<string, string> = {
    "kinetic-pop": t("studio.textClipPanel.animationKineticPop"),
    typewriter: t("studio.textClipPanel.animationTypewriter"),
    "slide-up": t("studio.textClipPanel.animationSlideUp"),
    fade: t("studio.textClipPanel.animationFade"),
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Label>{t("studio.textClipPanel.labelText")}</Label>
      <textarea
        aria-label="Subtitle text"
        value={clip.text}
        onChange={(e) => updateClip(clip.id, { text: e.target.value })}
        rows={3}
        style={{
          width: "100%",
          padding: 8,
          border: "1px solid var(--glass-border)",
          borderRadius: 6,
          background: "var(--surface-0)",
          color: "var(--text)",
          fontFamily: "inherit",
          fontSize: 13,
          lineHeight: 1.5,
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 10 }}>
        <NumberField
          label={t("studio.textClipPanel.labelSize")}
          value={style.size ?? 56}
          min={8}
          max={200}
          onChange={(v) => patchStyle({ size: v })}
        />
        <NumberField
          label="y%"
          value={clip.position?.yPct ?? 85}
          min={0}
          max={100}
          onChange={(v) =>
            updateClip(clip.id, {
              position: { ...clip.position, yPct: v },
            } as Partial<Clip>)
          }
        />
        <NumberField
          label={t("studio.textClipPanel.labelDuration")}
          value={clip.duration ?? 0}
          min={0.1}
          max={60}
          step={0.1}
          onChange={(v) => updateClip(clip.id, { duration: v } as Partial<Clip>)}
        />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <ColorField
          label={t("studio.textClipPanel.labelColor")}
          value={style.color ?? "#ffffff"}
          onChange={(v) => patchStyle({ color: v })}
        />
        <SelectField
          label={t("studio.textClipPanel.labelFont")}
          value={style.font ?? "Inter"}
          options={FONT_OPTIONS.map((f) => ({ value: f, label: f }))}
          onChange={(v) => patchStyle({ font: v })}
        />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <SelectField
          label={t("studio.textClipPanel.labelWeight")}
          value={String(style.weight ?? 700)}
          options={WEIGHT_OPTIONS.map((w) => ({
            value: String(w),
            label: `${w} ${weightLabels[w]}`,
          }))}
          onChange={(v) => patchStyle({ weight: Number(v) })}
        />
        <NumberField
          label={t("studio.textClipPanel.labelTracking")}
          value={style.tracking ?? 0}
          min={-20}
          max={200}
          onChange={(v) => patchStyle({ tracking: v })}
        />
        <CheckboxField
          label={t("studio.textClipPanel.labelItalic")}
          checked={style.italic ?? false}
          onChange={(v) => patchStyle({ italic: v })}
        />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <SelectField
          label={t("studio.textClipPanel.labelAnchor")}
          value={clip.position?.anchor ?? "bottom"}
          options={[
            { value: "top", label: t("studio.textClipPanel.anchorTop") },
            { value: "center", label: t("studio.textClipPanel.anchorCenter") },
            { value: "bottom", label: t("studio.textClipPanel.anchorBottom") },
          ]}
          onChange={(v) =>
            updateClip(clip.id, {
              position: {
                ...clip.position,
                anchor: v as "top" | "center" | "bottom",
              },
            } as Partial<Clip>)
          }
        />
        <SelectField
          label={t("studio.textClipPanel.labelAnimation")}
          value={clip.animation ?? "none"}
          options={[
            { value: "none", label: t("studio.textClipPanel.animationNone") },
            ...ANIMATION_OPTIONS.map((a) => ({
              value: a,
              label: animationLabels[a],
            })),
          ]}
          onChange={(v) =>
            updateClip(clip.id, {
              // `none` clears the optional field; the renderer's switch
              // falls through to the static (no-animation) default.
              animation: v === "none" ? undefined : (v as TextClip["animation"]),
            } as Partial<Clip>)
          }
        />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <CheckboxField
          label={t("studio.textClipPanel.labelStroke")}
          checked={!!style.stroke}
          onChange={(on) =>
            patchStyle({
              // Enabling seeds a sensible default; disabling clears the
              // optional object so it doesn't serialize a dead {0,#000}.
              stroke: on ? { width: 4, color: "#000000" } : undefined,
            })
          }
        />
        {style.stroke && (
          <>
            <NumberField
              label={t("studio.textClipPanel.labelStrokeWidth")}
              value={style.stroke.width}
              min={0}
              max={40}
              onChange={(v) =>
                patchStyle({ stroke: { ...style.stroke!, width: v } })
              }
            />
            <ColorField
              label={t("studio.textClipPanel.labelStrokeColor")}
              value={style.stroke.color}
              onChange={(v) =>
                patchStyle({ stroke: { ...style.stroke!, color: v } })
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--text-dimmer)",
      }}
    >
      {children}
    </span>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <Label>{label}</Label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          // #58 — HTML min/max only gate the spinner + :invalid styling,
          // not typed values; without an edit-site clamp the controlled
          // input round-trips Y%=999 / duration=0 straight into the
          // store and renders garbage. Mirror the StaticPropsPanel
          // pattern: clamp when bounds are provided, pass-through when
          // they aren't.
          let clamped = v;
          if (typeof min === "number") clamped = Math.max(min, clamped);
          if (typeof max === "number") clamped = Math.min(max, clamped);
          onChange(clamped);
        }}
        style={{
          width: "100%",
          padding: 6,
          border: "1px solid var(--glass-border)",
          borderRadius: 4,
          background: "var(--surface-0)",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <Label>{label}</Label>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: 6,
          border: "1px solid var(--glass-border)",
          borderRadius: 4,
          background: "var(--surface-0)",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <Label>{label}</Label>
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          height: 30,
          padding: 2,
          border: "1px solid var(--glass-border)",
          borderRadius: 4,
          background: "var(--surface-0)",
          cursor: "pointer",
        }}
      />
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        flex: 1,
      }}
    >
      <Label>{label}</Label>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, cursor: "pointer", accentColor: "var(--accent)" }}
      />
    </label>
  );
}

import { useMemo } from "react";
import { useComposition } from "../../store";
import type { Clip } from "../../types";
import { useT } from "@/i18n/useT";

// Minimal text-clip editor mounted in the Inspector when the selection is
// a `kind: "text"` clip. Studio's Inspector previously had no editor for
// these — selecting a subtitle showed only "no media binding", so users
// could see a subtitle on the canvas but had no way to change its text
// from the UI. This panel closes that gap; live edits flow through
// `updateClip` and immediately re-render the preview.
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Label>{t("studio.textClipPanel.labelText")}</Label>
      <textarea
        aria-label="Subtitle text"
        value={selected.text}
        onChange={(e) => updateClip(selected.id, { text: e.target.value })}
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
          value={selected.style?.size ?? 56}
          min={8}
          max={200}
          onChange={(v) =>
            updateClip(selected.id, {
              style: { ...selected.style, size: v },
            } as Partial<Clip>)
          }
        />
        <NumberField
          label="y%"
          value={selected.position?.yPct ?? 85}
          min={0}
          max={100}
          onChange={(v) =>
            updateClip(selected.id, {
              position: { ...selected.position, yPct: v },
            } as Partial<Clip>)
          }
        />
        <NumberField
          label={t("studio.textClipPanel.labelDuration")}
          value={selected.duration ?? 0}
          min={0.1}
          max={60}
          step={0.1}
          onChange={(v) =>
            updateClip(selected.id, { duration: v } as Partial<Clip>)
          }
        />
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
          if (Number.isFinite(v)) onChange(v);
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

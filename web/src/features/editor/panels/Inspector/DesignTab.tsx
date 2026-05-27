import { useEditor } from "../../store";
import { PALETTES } from "../../palettes";
import type { PaletteId } from "../../types";
import { useT, type MessageKey } from "@/i18n/useT";

// Font + layout option labels are i18n keys (not literal text) — resolved
// inside the component so they re-render on locale toggle.
const FONT_OPTIONS: Array<{ id: "serif" | "sans" | "mono"; key: MessageKey }> = [
  { id: "serif", key: "editor.designTab.fontSerif" },
  { id: "sans", key: "editor.designTab.fontSans" },
  { id: "mono", key: "editor.designTab.fontMono" },
];

const LAYOUT_OPTIONS: Array<{
  id: "centered" | "left" | "split";
  key: MessageKey;
}> = [
  { id: "centered", key: "editor.designTab.layoutCentered" },
  { id: "left", key: "editor.designTab.layoutLeft" },
  { id: "split", key: "editor.designTab.layoutSplit" },
];

export function DesignTab() {
  const car = useEditor((s) => s.car);
  const updateGlobals = useEditor((s) => s.updateGlobals);
  const applyLayout = useEditor((s) => s.applyLayout);
  const applyHeadlineFont = useEditor((s) => s.applyHeadlineFont);
  const applyPalette = useEditor((s) => s.applyPalette);
  const t = useT();
  if (!car) return null;
  const g = car.globals;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Field label={t("editor.designTab.headlineFont")}>
        <div style={btnRow}>
          {FONT_OPTIONS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => applyHeadlineFont(f.id)}
              data-active={g.headlineFont === f.id}
              style={chip(g.headlineFont === f.id)}
            >
              {t(f.key)}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t("editor.designTab.palette")}>
        <div style={btnRow}>
          {(Object.keys(PALETTES) as PaletteId[]).map((id) => {
            const p = PALETTES[id];
            const active = g.palette === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => applyPalette(id)}
                data-active={active}
                style={{
                  ...chip(active),
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    background: p.bg,
                    border: "1px solid var(--border, rgba(0,0,0,0.1))",
                  }}
                />
                {p.name}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={t("editor.designTab.layout")}>
        <div style={btnRow}>
          {LAYOUT_OPTIONS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => applyLayout(l.id)}
              data-active={g.layout === l.id}
              style={chip(g.layout === l.id)}
            >
              {t(l.key)}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t("editor.designTab.effects")}>
        <Slider
          label={t("editor.designTab.effectGrain")}
          value={g.effects.grain}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) =>
            updateGlobals({ effects: { ...g.effects, grain: v } })
          }
        />
        <Slider
          label={t("editor.designTab.effectGradient")}
          value={g.effects.gradient}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) =>
            updateGlobals({ effects: { ...g.effects, gradient: v } })
          }
        />
        {/* #70 — the "sharpen" slider was a deceptive dead control: it wrote
            globals.effects.sharpen but NO renderer consumes it (EffectsOverlay
            is an additive overlay system — gradient/grain Rects with blend
            modes — which structurally can't express a pixel-convolution sharpen).
            Removed the slider rather than ship a fake control between two real
            ones. The schema field is retained (see types.ts) so existing
            carousel.yaml round-trips; wire a real Konva.Filters.Enhance pass on
            the image layers + matching export path if sharpen is ever built. */}
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-dimmer)",
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        fontFamily: "var(--font-mono)",
      }}
    >
      <span style={{ width: 70, color: "var(--text-soft)" }}>{label}</span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ width: 40, textAlign: "right", color: "var(--text-soft)" }}>
        {value.toFixed(2)}
      </span>
    </label>
  );
}

const btnRow: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
};

const chip = (active: boolean): React.CSSProperties => ({
  padding: "6px 10px",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.05em",
  border: active
    ? "1px solid var(--accent, #2a3a4a)"
    : "1px solid var(--border, rgba(0,0,0,0.12))",
  background: active ? "var(--accent, #2a3a4a)" : "transparent",
  color: active ? "var(--bg, #fff)" : "var(--text-soft)",
  borderRadius: 4,
  cursor: "pointer",
});

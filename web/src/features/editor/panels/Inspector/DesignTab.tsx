import { useEditor } from "../../store";
import { PALETTES } from "../../palettes";
import type { PaletteId } from "../../types";

const FONT_OPTIONS: Array<{ id: "serif" | "sans" | "mono"; label: string }> = [
  { id: "serif", label: "Serif" },
  { id: "sans", label: "Sans" },
  { id: "mono", label: "Mono" },
];

const LAYOUT_OPTIONS: Array<{
  id: "centered" | "left" | "split";
  label: string;
}> = [
  { id: "centered", label: "Centered" },
  { id: "left", label: "Left" },
  { id: "split", label: "Split" },
];

export function DesignTab() {
  const car = useEditor((s) => s.car);
  const updateGlobals = useEditor((s) => s.updateGlobals);
  if (!car) return null;
  const g = car.globals;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Field label="Headline font">
        <div style={btnRow}>
          {FONT_OPTIONS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => updateGlobals({ headlineFont: f.id })}
              data-active={g.headlineFont === f.id}
              style={chip(g.headlineFont === f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Palette">
        <div style={btnRow}>
          {(Object.keys(PALETTES) as PaletteId[]).map((id) => {
            const p = PALETTES[id];
            const active = g.palette === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => updateGlobals({ palette: id })}
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

      <Field label="Layout">
        <div style={btnRow}>
          {LAYOUT_OPTIONS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => updateGlobals({ layout: l.id })}
              data-active={g.layout === l.id}
              style={chip(g.layout === l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Effects">
        <Slider
          label="grain"
          value={g.effects.grain}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) =>
            updateGlobals({ effects: { ...g.effects, grain: v } })
          }
        />
        <Slider
          label="gradient"
          value={g.effects.gradient}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) =>
            updateGlobals({ effects: { ...g.effects, gradient: v } })
          }
        />
        <Slider
          label="sharpen"
          value={g.effects.sharpen}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) =>
            updateGlobals({ effects: { ...g.effects, sharpen: v } })
          }
        />
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

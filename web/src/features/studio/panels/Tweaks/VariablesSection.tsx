/**
 * Variables Tweaks section — H2.3.
 *
 * Lists declared variables on the active composition and lets the user
 * edit defaults inline. Edits write straight to the composition store
 * (which round-trips to disk via the existing autosave flow).
 *
 * Layout choice per ADR-005 precedent: lives as a section in the
 * existing Tweaks panel — same affordance as ThemeSection /
 * PlatformPresetSection. No new tab / popover surface required. This
 * is the HITL decision (the issue body asked for "in Tweaks panel? new
 * tab? popover?"); Tweaks-section was chosen for consistency with the
 * established panel pattern.
 */
import { useComposition } from "@/features/studio/store";
import type { VariableDeclaration } from "@/features/studio/types";

export function VariablesSection() {
  const comp = useComposition((s) => s.comp);
  const loadComposition = useComposition((s) => s.loadComposition);
  if (!comp) return null;
  const variables = (comp.variables ?? []) as VariableDeclaration[];

  if (variables.length === 0) {
    return (
      <section style={{ padding: "12px 16px" }}>
        <h4 style={headingStyle}>Variables</h4>
        <p style={{ fontSize: 11, color: "var(--text-soft)", margin: 0 }}>
          No variables declared. Add a <code>variables</code> block in
          composition.yaml to enable template overrides.
        </p>
      </section>
    );
  }

  const updateDefault = (id: string, next: string | number | boolean) => {
    if (!comp.variables) return;
    const idx = comp.variables.findIndex((v) => v.id === id);
    if (idx < 0) return;
    const updatedVar = { ...comp.variables[idx]!, default: next };
    const variablesNext = [...comp.variables];
    variablesNext[idx] = updatedVar;
    loadComposition({ ...comp, variables: variablesNext });
  };

  return (
    <section style={{ padding: "12px 16px" }}>
      <h4 style={headingStyle}>Variables</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {variables.map((v) => (
          <VariableRow key={v.id} decl={v} onChange={updateDefault} />
        ))}
      </div>
    </section>
  );
}

const headingStyle = {
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: 1,
  color: "var(--text-soft)" as string,
  margin: "0 0 8px",
};

interface VariableRowProps {
  decl: VariableDeclaration;
  onChange: (id: string, next: string | number | boolean) => void;
}

function VariableRow({ decl, onChange }: VariableRowProps) {
  const labelEl = (
    <label
      htmlFor={`var-${decl.id}`}
      style={{
        display: "block",
        fontSize: 10,
        color: "var(--text-soft)",
        marginBottom: 4,
      }}
    >
      {decl.label}{" "}
      <code style={{ opacity: 0.6 }}>${`{${decl.id}}`}</code>
    </label>
  );

  switch (decl.type) {
    case "boolean":
      return (
        <div>
          {labelEl}
          <input
            id={`var-${decl.id}`}
            type="checkbox"
            checked={decl.default === true}
            onChange={(e) => onChange(decl.id, e.target.checked)}
          />
        </div>
      );
    case "number":
      return (
        <div>
          {labelEl}
          <input
            id={`var-${decl.id}`}
            type="number"
            value={typeof decl.default === "number" ? decl.default : 0}
            onChange={(e) => onChange(decl.id, Number(e.target.value))}
            style={inputStyle}
          />
        </div>
      );
    case "color":
      return (
        <div>
          {labelEl}
          <input
            id={`var-${decl.id}`}
            type="color"
            value={typeof decl.default === "string" ? decl.default : "#000000"}
            onChange={(e) => onChange(decl.id, e.target.value)}
            style={{ ...inputStyle, height: 32, padding: 0 }}
          />
        </div>
      );
    case "enum":
      return (
        <div>
          {labelEl}
          <select
            id={`var-${decl.id}`}
            value={String(decl.default ?? "")}
            onChange={(e) => onChange(decl.id, e.target.value)}
            style={inputStyle}
          >
            {(decl.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      );
    case "string":
    default:
      return (
        <div>
          {labelEl}
          <input
            id={`var-${decl.id}`}
            type="text"
            value={typeof decl.default === "string" ? decl.default : ""}
            onChange={(e) => onChange(decl.id, e.target.value)}
            style={inputStyle}
          />
        </div>
      );
  }
}

const inputStyle = {
  width: "100%",
  padding: "4px 6px",
  background: "var(--surface-2)",
  border: "1px solid var(--glass-border)",
  borderRadius: 4,
  color: "var(--text-strong)",
  fontSize: 12,
};

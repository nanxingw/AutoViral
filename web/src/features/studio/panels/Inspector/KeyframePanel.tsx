import { useMemo, useState } from "react";
import { useComposition } from "../../store";
import type {
  Clip,
  Keyframe,
  KeyframeEasing,
  KeyframeProperty,
} from "../../types";

// Phase 8.2.D — Inspector KeyframePanel.
//
// Table-style v1 (D6): one row per keyframe, grouped by property and sorted
// by time within each group. Mounts in InspectorTab below VariantSwitcher
// (D7). Hidden for TextClip selection (D8). Property options vary by clip
// kind (D5: volume only on AudioClip).
//
// Indexing pitfall: store.removeKeyframe / updateKeyframe operate on the
// *original-array index* — the position in clip.keyframes — not the sorted
// display order. We carry the original index through `{ kf, idx }` rows.

const EASINGS: KeyframeEasing[] = ["linear", "easeIn", "easeOut", "easeInOut"];

function propertiesForClip(kind: Clip["kind"]): KeyframeProperty[] {
  switch (kind) {
    case "video":
      // Phase 8.3.D — VideoClip gains "speed" (D1: VideoClip-only in v1).
      return ["scale", "x", "y", "rotation", "speed"];
    case "overlay":
      return ["scale", "x", "y", "rotation", "opacity"];
    case "audio":
      return ["volume"];
    case "text":
      return [];
  }
}

function defaultStaticValue(clip: Clip, prop: KeyframeProperty): number {
  if (clip.kind === "video") {
    // Phase 8.3.D — VideoClip has no static `speed` field; 1.0 IS the
    // no-keyframes baseline (D3). Return 1.0 to seed the AddForm input.
    if (prop === "speed") return 1.0;
    if (prop === "scale") return clip.transforms.scale;
    if (prop === "x") return clip.transforms.x;
    if (prop === "y") return clip.transforms.y;
    if (prop === "rotation") return clip.transforms.rotation;
  }
  if (clip.kind === "overlay") {
    if (prop === "opacity") return clip.opacity;
    if (prop === "scale") return 1;
    return 0;
  }
  if (clip.kind === "audio") {
    if (prop === "volume") return clip.volume;
  }
  return 0;
}

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
};

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  padding: "4px 6px",
  background: "var(--surface-0)",
  border: "1px solid var(--glass-border)",
  borderRadius: 6,
  color: "var(--text)",
  width: 60,
};

export function KeyframePanel() {
  const comp = useComposition((s) => s.comp);
  const selection = useComposition((s) => s.selection);
  const addKeyframe = useComposition((s) => s.addKeyframe);
  const removeKeyframe = useComposition((s) => s.removeKeyframe);
  const updateKeyframe = useComposition((s) => s.updateKeyframe);
  const [adding, setAdding] = useState(false);

  const clip = useMemo<Clip | null>(() => {
    if (!comp || !selection) return null;
    for (const t of comp.tracks) {
      const c = (t.clips as Clip[]).find((c) => c.id === selection);
      if (c) return c;
    }
    return null;
  }, [comp, selection]);

  if (!clip) {
    return <Empty>Select a clip in the timeline to add keyframes</Empty>;
  }
  if (clip.kind === "text") {
    return <Empty>Text clips use the animation enum, not keyframes</Empty>;
  }

  const props = propertiesForClip(clip.kind);
  const rawKfs = ((clip as { keyframes?: Keyframe[] }).keyframes ?? []).map(
    (kf, i) => ({ kf, idx: i }),
  );

  // Group by property; sort each group by time. Property iteration order
  // matches `propertiesForClip` so the display is stable.
  const grouped = new Map<KeyframeProperty, Array<{ kf: Keyframe; idx: number }>>();
  for (const entry of rawKfs) {
    const arr = grouped.get(entry.kf.property) ?? [];
    arr.push(entry);
    grouped.set(entry.kf.property, arr);
  }
  for (const arr of grouped.values()) arr.sort((a, b) => a.kf.time - b.kf.time);
  const orderedGroups: Array<[KeyframeProperty, Array<{ kf: Keyframe; idx: number }>]> = [];
  for (const p of props) {
    const arr = grouped.get(p);
    if (arr && arr.length > 0) orderedGroups.push([p, arr]);
  }

  const totalKfs = rawKfs.length;

  return (
    <section
      data-testid="keyframe-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 10,
        background: "var(--surface-0)",
        border: "1px solid var(--glass-border)",
        borderRadius: 10,
      }}
    >
      <Header
        kfs={totalKfs}
        adding={adding}
        onAddClick={() => setAdding(true)}
      />
      {adding && (
        <AddForm
          properties={props}
          defaultValueFor={(p) => defaultStaticValue(clip, p)}
          onSubmit={(kf) => {
            addKeyframe(clip.id, kf);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {totalKfs === 0 && !adding && (
        <Empty>
          No keyframes yet — click &ldquo;Add keyframe&rdquo; to author your
          first one
        </Empty>
      )}
      {orderedGroups.map(([prop, rows]) => (
        <PropertyBlock
          key={prop}
          property={prop}
          rows={rows}
          onRemove={(idx) => removeKeyframe(clip.id, idx)}
          onUpdate={(idx, patch) => updateKeyframe(clip.id, idx, patch)}
        />
      ))}
    </section>
  );
}

function Header({
  kfs,
  adding,
  onAddClick,
}: {
  kfs: number;
  adding: boolean;
  onAddClick: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={labelStyle}>Keyframes · {kfs}</div>
      <button
        type="button"
        onClick={onAddClick}
        disabled={adding}
        style={{
          padding: "4px 10px",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          border: "1px solid var(--glass-border)",
          background: "var(--surface-0)",
          color: "var(--accent)",
          borderRadius: 6,
          cursor: adding ? "default" : "pointer",
          opacity: adding ? 0.5 : 1,
        }}
      >
        Add keyframe
      </button>
    </div>
  );
}

function AddForm({
  properties,
  defaultValueFor,
  onSubmit,
  onCancel,
}: {
  properties: KeyframeProperty[];
  defaultValueFor: (p: KeyframeProperty) => number;
  onSubmit: (kf: Keyframe) => void;
  onCancel: () => void;
}) {
  const [property, setProperty] = useState<KeyframeProperty>(properties[0]);
  const [time, setTime] = useState<string>("0");
  const [value, setValue] = useState<string>(String(defaultValueFor(properties[0])));
  const [easing, setEasing] = useState<KeyframeEasing>("linear");

  const handleSubmit = () => {
    const t = Number(time);
    const v = Number(value);
    if (!Number.isFinite(t) || !Number.isFinite(v)) return;
    onSubmit({ property, time: t, value: v, easing });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        padding: 8,
        background: "var(--surface-1, var(--surface-0))",
        border: "1px solid var(--glass-border)",
        borderRadius: 8,
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={labelStyle}>Property</span>
        <select
          value={property}
          onChange={(e) => {
            const next = e.target.value as KeyframeProperty;
            setProperty(next);
            setValue(String(defaultValueFor(next)));
          }}
          style={inputStyle}
        >
          {properties.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={labelStyle}>Time (s)</span>
        <input
          type="number"
          step="0.1"
          min="0"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={labelStyle}>Value</span>
        <input
          type="number"
          step="0.05"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={labelStyle}>Easing</span>
        <select
          value={easing}
          onChange={(e) => setEasing(e.target.value as KeyframeEasing)}
          style={inputStyle}
        >
          {EASINGS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: "flex", gap: 6, alignSelf: "flex-end" }}>
        <button
          type="button"
          onClick={handleSubmit}
          style={{
            padding: "5px 10px",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            border: "1px solid var(--accent)",
            background: "var(--accent)",
            color: "var(--surface-0)",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Submit
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "5px 10px",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            border: "1px solid var(--glass-border)",
            background: "transparent",
            color: "var(--text-dim)",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function PropertyBlock({
  property,
  rows,
  onRemove,
  onUpdate,
}: {
  property: KeyframeProperty;
  rows: Array<{ kf: Keyframe; idx: number }>;
  onRemove: (idx: number) => void;
  onUpdate: (idx: number, patch: Partial<Keyframe>) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={labelStyle}>{property}</div>
      {rows.map(({ kf, idx }) => (
        <Row
          key={`${property}-${idx}`}
          kf={kf}
          onUpdate={(patch) => onUpdate(idx, patch)}
          onRemove={() => onRemove(idx)}
        />
      ))}
    </div>
  );
}

function Row({
  kf,
  onUpdate,
  onRemove,
}: {
  kf: Keyframe;
  onUpdate: (patch: Partial<Keyframe>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      data-testid="keyframe-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px",
        background: "var(--surface-0)",
        border: "1px solid var(--glass-border)",
        borderRadius: 6,
      }}
    >
      <span
        style={{
          ...labelStyle,
          minWidth: 56,
        }}
      >
        {kf.property}
      </span>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={labelStyle}>t</span>
        <input
          aria-label={`time for ${kf.property} keyframe`}
          type="number"
          step="0.1"
          min="0"
          defaultValue={kf.time}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v !== kf.time) onUpdate({ time: v });
          }}
          style={inputStyle}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={labelStyle}>value</span>
        <input
          aria-label={`value for ${kf.property} keyframe`}
          type="number"
          step="0.05"
          defaultValue={kf.value}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v !== kf.value) onUpdate({ value: v });
          }}
          style={inputStyle}
        />
      </label>
      <select
        aria-label={`easing for ${kf.property} keyframe`}
        value={kf.easing}
        onChange={(e) => onUpdate({ easing: e.target.value as KeyframeEasing })}
        style={inputStyle}
      >
        {EASINGS.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Delete keyframe"
        onClick={onRemove}
        style={{
          marginLeft: "auto",
          padding: "3px 8px",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          border: "1px solid var(--glass-border)",
          background: "transparent",
          color: "var(--text-dim)",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        ×
      </button>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 12,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--text-dim)",
        background: "var(--surface-0)",
        border: "1px dashed var(--glass-border)",
        borderRadius: 8,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

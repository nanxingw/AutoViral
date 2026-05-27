import { useEditor } from "../../store";
import { apiFetch } from "@/lib/api";
import { useState, useEffect, useRef } from "react";
import type { TextLayer } from "../../types";
import { makeTextLayer } from "../../services/layout";
import { useT } from "@/i18n/useT";

export function CopyTab({ workId }: { workId: string }) {
  const car = useEditor((s) => s.car);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const selectionLayerId = useEditor((s) => s.selectionLayerId);
  const updateLayer = useEditor((s) => s.updateLayer);
  const addLayer = useEditor((s) => s.addLayer);
  const removeLayer = useEditor((s) => s.removeLayer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // #66 — removeLayer was a fully-implemented + tested store action with ZERO UI
  // consumers, so deleting one text layer forced nuking the whole slide. This is
  // its first call site. Two-click inline confirm (not a modal — a single layer
  // is low-stakes + easily re-added) guards against an accidental click since the
  // editor has no inline undo. Deliberately NOT a global Delete/Backspace key:
  // this tab has a textarea, and a global handler would eat Backspace mid-typing.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const t = useT();
  // R37: same unmount-safety pattern as R36 AITab. /text-rewrite is a
  // single round-trip (1-5s) so the window is shorter than AITab's 60s
  // poll, but setError/setBusy on unmounted CopyTab still throws React
  // warnings + the in-flight updateLayer could land on a different
  // work's store after a workId switch.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Reset the delete-confirm arming whenever the selected layer changes, so a
  // primed "click again to delete" can't carry over to a different layer.
  useEffect(() => {
    setConfirmingDelete(false);
  }, [selectionLayerId]);

  const slide = car?.slides.find((s) => s.id === currentSlideId);
  const candidate = slide?.layers.find((l) => l.id === selectionLayerId);
  const selected: TextLayer | undefined =
    candidate && candidate.kind === "text" ? candidate : undefined;
  // Distinguish the two empty states: a slide WITH text layers but none
  // selected ("pick one") vs. a slide with zero text layers ("none exist yet").
  const slideHasText = Boolean(slide?.layers.some((l) => l.kind === "text"));

  const onRewrite = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      // Synchronous rewrite. The agent /invoke route is async (202 + chat
      // stream) and doesn't fit "click → text updates" UX. /text-rewrite
      // thin-wraps OpenRouter chat-completions and returns { text }.
      const res = await apiFetch<{ text?: string }>(
        `/api/works/${workId}/text-rewrite`,
        {
          method: "POST",
          body: { current: selected.text, intent: "rewrite-copy" },
        },
      );
      if (!aliveRef.current) return;
      const next = res?.text;
      if (typeof next === "string" && next.length > 0) {
        updateLayer(selected.id, { text: next });
      } else {
        setError(t("editor.copyTab.emptyResponse"));
      }
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : t("editor.copyTab.rewriteFailed"));
    } finally {
      // setBusy is in finally — guard with alive check too.
      if (aliveRef.current) setBusy(false);
    }
  };

  // #43 — the missing last mile. `addLayer` was fully implemented + tested in
  // the store but had no UI call site, so a blank slide or a text-layer-less
  // carousel left this tab a dead end. Wire it here: build a globals-styled
  // text layer and push it; addLayer also selects it, so the component
  // re-renders straight into the edit form below for immediate typing.
  const canAddLayer = Boolean(car && currentSlideId);
  const onAddTextLayer = () => {
    if (!car || !currentSlideId) return;
    addLayer(makeTextLayer(car));
  };

  const addTextLayerButton = canAddLayer ? (
    <button
      type="button"
      onClick={onAddTextLayer}
      style={{
        padding: "9px 14px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        border: "1px dashed var(--accent, #2a3a4a)",
        background: "transparent",
        color: "var(--accent, #2a3a4a)",
        borderRadius: 6,
        cursor: "pointer",
        alignSelf: "flex-start",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {t("editor.copyTab.addTextLayer")}
    </button>
  ) : null;

  if (!selected) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-dimmer)",
          padding: "12px 0",
        }}
      >
        <span>{t(canAddLayer && !slideHasText ? "editor.copyTab.emptyHint" : "editor.copyTab.empty")}</span>
        {addTextLayerButton}
      </div>
    );
  }

  // #81 — per-layer style controls. The TextLayer schema + the Konva
  // TextLayerNode renderer already support color/size/font/weight/italic/
  // align/tracking end-to-end; CopyTab only ever wrote `text`. updateLayer
  // does a shallow Object.assign, so each style edit MUST spread the rest
  // of `style` or it wipes the sibling fields (same guard as Studio #86).
  const style = selected.style;
  const patchStyle = (next: Partial<TextLayer["style"]>) =>
    updateLayer(selected.id, { style: { ...style, ...next } });
  // `style.color` may hold a palette sentinel ("palette:fg"/"palette:accent")
  // rather than a hex; a <input type=color> can't display those, so show a
  // neutral hex until the user explicitly picks a color (which then becomes
  // an explicit per-layer override, the intended behaviour).
  const colorIsHex = /^#[0-9a-fA-F]{3,8}$/.test(style.color);
  const colorInputValue = colorIsHex ? style.color : "#111111";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-dimmer)",
        }}
      >
        {t("editor.copyTab.headline")}
      </label>
      <textarea
        aria-label="Layer text"
        value={selected.text}
        onChange={(e) => updateLayer(selected.id, { text: e.target.value })}
        rows={6}
        style={{
          width: "100%",
          padding: "10px 12px",
          border: "1px solid var(--border, rgba(0,0,0,0.12))",
          borderRadius: 8,
          background: "var(--surface-0, transparent)",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: 1.55,
          resize: "vertical",
          outline: "none",
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
        onFocus={(e) => {
          e.target.style.borderColor = "var(--accent)";
          e.target.style.boxShadow = "0 0 0 3px var(--accent-glow, rgba(168,197,214,0.18))";
        }}
        onBlur={(e) => {
          e.target.style.borderColor = "var(--border, rgba(0,0,0,0.12))";
          e.target.style.boxShadow = "none";
        }}
      />

      {/* #81 — per-layer text style controls. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <FieldLabel>{t("editor.copyTab.styleSection")}</FieldLabel>
        <div style={{ display: "flex", gap: 8 }}>
          <StyleColor
            label={t("editor.copyTab.styleColor")}
            value={colorInputValue}
            onChange={(v) => patchStyle({ color: v })}
          />
          <StyleNumber
            label={t("editor.copyTab.styleSize")}
            value={style.size}
            min={8}
            max={240}
            onChange={(v) => patchStyle({ size: v })}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <StyleSelect
            label={t("editor.copyTab.styleFont")}
            value={style.font}
            options={[
              { value: "serif", label: t("editor.copyTab.fontSerif") },
              { value: "sans", label: t("editor.copyTab.fontSans") },
              { value: "mono", label: t("editor.copyTab.fontMono") },
            ]}
            onChange={(v) => patchStyle({ font: v as TextLayer["style"]["font"] })}
          />
          <StyleSelect
            label={t("editor.copyTab.styleWeight")}
            value={String(style.weight)}
            options={[400, 500, 600, 700, 800, 900].map((w) => ({
              value: String(w),
              label: String(w),
            }))}
            onChange={(v) => patchStyle({ weight: Number(v) })}
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <StyleSelect
            label={t("editor.copyTab.styleAlign")}
            value={style.align}
            options={[
              { value: "left", label: t("editor.copyTab.alignLeft") },
              { value: "center", label: t("editor.copyTab.alignCenter") },
              { value: "right", label: t("editor.copyTab.alignRight") },
            ]}
            onChange={(v) => patchStyle({ align: v as TextLayer["style"]["align"] })}
          />
          <StyleNumber
            label={t("editor.copyTab.styleTracking")}
            value={style.tracking}
            min={-10}
            max={80}
            onChange={(v) => patchStyle({ tracking: v })}
          />
          <StyleCheckbox
            label={t("editor.copyTab.styleItalic")}
            checked={style.italic}
            onChange={(v) => patchStyle({ italic: v })}
          />
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onRewrite}
        style={{
          padding: "10px 14px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          border: "1px solid var(--accent, #2a3a4a)",
          background: busy ? "transparent" : "var(--accent, #2a3a4a)",
          color: busy ? "var(--text-dim)" : "var(--bg, #fff)",
          borderRadius: 6,
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.65 : 1,
          boxShadow: busy ? "none" : "0 1px 2px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)",
          transition: "transform 0.1s, box-shadow 0.15s, opacity 0.15s",
        }}
      >
        {busy ? t("editor.copyTab.busy") : t("editor.copyTab.rewriteWithAI")}
      </button>
      {error && (
        <div
          style={{
            color: "var(--text-warn, #c44a4a)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.02em",
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}
      {/* Let users keep stacking layers without going back to an empty state. */}
      {addTextLayerButton}
      {/* #66 — delete THIS layer (vs. the only prior option: nuking the whole
          slide). Two-click inline confirm; the armed state is reset by the
          selection-change effect above. */}
      <button
        type="button"
        onClick={() => {
          if (confirmingDelete) {
            removeLayer(selected.id);
            setConfirmingDelete(false);
          } else {
            setConfirmingDelete(true);
          }
        }}
        style={{
          padding: "8px 12px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.04em",
          border: `1px solid ${confirmingDelete ? "var(--text-warn, #c44a4a)" : "var(--border, rgba(0,0,0,0.12))"}`,
          background: confirmingDelete ? "rgba(196, 74, 74, 0.08)" : "transparent",
          color: confirmingDelete ? "var(--text-warn, #c44a4a)" : "var(--text-dim)",
          borderRadius: 6,
          cursor: "pointer",
          alignSelf: "flex-start",
          transition: "background 0.15s, color 0.15s, border-color 0.15s",
        }}
      >
        {confirmingDelete ? t("editor.copyTab.confirmDeleteLayer") : t("editor.copyTab.deleteLayer")}
      </button>
    </div>
  );
}

// ─── #81 style-control primitives (compact, match CopyTab's mono aesthetic) ──

const fieldLabelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-dimmer)",
};

const controlStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 6px",
  border: "1px solid var(--border, rgba(0,0,0,0.12))",
  borderRadius: 6,
  background: "var(--surface-0, transparent)",
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={fieldLabelStyle}>{children}</label>;
}

function StyleSelect({
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
      <FieldLabel>{label}</FieldLabel>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={controlStyle}
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

function StyleNumber({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const raw = Number(e.target.value);
          if (!Number.isFinite(raw)) return;
          // Clamp at the edit site — HTML min/max only gate the spinner.
          onChange(Math.min(max, Math.max(min, raw)));
        }}
        style={controlStyle}
      />
    </label>
  );
}

function StyleColor({
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
      <FieldLabel>{label}</FieldLabel>
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...controlStyle, height: 28, padding: 2, cursor: "pointer" }}
      />
    </label>
  );
}

function StyleCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--accent)" }}
      />
    </label>
  );
}

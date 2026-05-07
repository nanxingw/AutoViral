import { useEditor } from "../../store";
import { apiFetch } from "@/lib/api";
import { useState } from "react";
import type { TextLayer } from "../../types";
import { useT } from "@/i18n/useT";

export function CopyTab({ workId }: { workId: string }) {
  const car = useEditor((s) => s.car);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  const selectionLayerId = useEditor((s) => s.selectionLayerId);
  const updateLayer = useEditor((s) => s.updateLayer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  const slide = car?.slides.find((s) => s.id === currentSlideId);
  const candidate = slide?.layers.find((l) => l.id === selectionLayerId);
  const selected: TextLayer | undefined =
    candidate && candidate.kind === "text" ? candidate : undefined;

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
      const next = res?.text;
      if (typeof next === "string" && next.length > 0) {
        updateLayer(selected.id, { text: next });
      } else {
        setError(t("editor.copyTab.emptyResponse"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "rewrite failed");
    } finally {
      setBusy(false);
    }
  };

  if (!selected) {
    return (
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-dimmer)",
          padding: "12px 0",
        }}
      >
        {t("editor.copyTab.empty")}
      </div>
    );
  }

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
          padding: 8,
          border: "1px solid var(--border, rgba(0,0,0,0.12))",
          borderRadius: 6,
          background: "transparent",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          resize: "vertical",
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={onRewrite}
        style={{
          padding: "6px 12px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.05em",
          border: "1px solid var(--border, rgba(0,0,0,0.12))",
          background: "transparent",
          color: "var(--text-soft)",
          borderRadius: 4,
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? t("editor.copyTab.busy") : t("editor.copyTab.rewriteWithAI")}
      </button>
      {error && (
        <div style={{ color: "tomato", fontSize: 11 }}>{error}</div>
      )}
    </div>
  );
}

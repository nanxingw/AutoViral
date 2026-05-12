import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useEditor } from "../../store";
import { loadCarousel } from "../../services/carousel";
import { useT, type MessageKey } from "@/i18n/useT";
import { RegenerateConfirmDialog } from "./RegenerateConfirmDialog";

// QUICK_STYLES carries (en prompt sent to the agent, i18n key for the chip
// label). Keep the prompt itself English even when the UI is Chinese — the
// upstream image model takes an English style cue more reliably than a CN
// translation, while the user-facing chip is still localised.
const QUICK_STYLES: Array<{ prompt: string; key: MessageKey }> = [
  { prompt: "minimal editorial", key: "editor.aiTab.quick.minimalEditorial" },
  { prompt: "soft pastel", key: "editor.aiTab.quick.softPastel" },
  { prompt: "neon cyberpunk", key: "editor.aiTab.quick.neonCyberpunk" },
  { prompt: "earthy zine", key: "editor.aiTab.quick.earthyZine" },
  { prompt: "high-contrast noir", key: "editor.aiTab.quick.highContrastNoir" },
  { prompt: "sun-bleached film", key: "editor.aiTab.quick.sunBleachedFilm" },
];

export function AITab({ workId }: { workId: string }) {
  const car = useEditor((s) => s.car);
  const reload = useEditor((s) => s.loadCarousel);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<null | "regen" | "quick">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const slideCount = car?.slides.length ?? 0;
  const t = useT();
  // R36: cancellation flag for in-flight polls. The poll loop is
  // fire-and-forget by design (button frees up immediately) — but if
  // the component unmounts (user closes Editor / switches workId) we
  // need to stop polling so the loop doesn't:
  //   - call reload() on stale store state
  //   - call setMsg() on an unmounted component (React warning)
  //   - hold closures to old workId for up to 60s
  // Ref-based flag (not state) so polling reads the latest value
  // without re-subscribing.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /**
   * Poll carousel.updatedAt every 5s for up to 60s after triggering an
   * agent run. When the file mtime moves past the snapshot we took at
   * dispatch time, the agent has rewritten carousel.yaml — pull the
   * fresh state into the store so the canvas refreshes without a
   * manual reload.
   *
   * R36: every iteration checks aliveRef before doing any state-mutating
   * work — early return if the component already unmounted.
   */
  const watchForCarouselUpdate = async (
    sinceISO: string,
    timeoutMs = 60_000,
  ) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 5_000));
      if (!aliveRef.current) return;
      try {
        const next = await loadCarousel(workId);
        if (!aliveRef.current) return;
        if (next && next.updatedAt > sinceISO) {
          reload(next);
          setMsg(t("editor.aiTab.msgUpdated"));
          return;
        }
      } catch {
        // ignore transient fetch failures, keep polling.
      }
    }
    if (!aliveRef.current) return;
    setMsg(t("editor.aiTab.msgQueuedTimeout"));
  };

  const runAssets = async (
    input: Record<string, unknown>,
    label: "regen" | "quick",
  ) => {
    setBusy(label);
    setMsg(null);
    const since = car?.updatedAt ?? new Date(0).toISOString();
    try {
      await apiFetch(`/api/works/${workId}/invoke`, {
        method: "POST",
        body: { module: "assets", input },
      });
      setMsg(t("editor.aiTab.msgQueued"));
      // Fire-and-forget poll; don't await so the button frees up.
      void watchForCarouselUpdate(since);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "request failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--text-dimmer)",
          }}
        >
          {t("editor.aiTab.stylePrompt")}
        </label>
        <textarea
          aria-label="Style prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          placeholder={t("editor.aiTab.stylePlaceholder")}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid var(--border, rgba(0,0,0,0.12))",
            borderRadius: 8,
            background: "var(--surface-0, transparent)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
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
      </div>

      <div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--text-dimmer)",
            marginBottom: 6,
          }}
        >
          {t("editor.aiTab.quickStyles")}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {QUICK_STYLES.map((q) => {
            const isDisabled = busy !== null;
            return (
              <button
                key={q.prompt}
                type="button"
                onClick={() => runAssets({ stylePrompt: q.prompt }, "quick")}
                disabled={isDisabled}
                style={{
                  ...chipBtn,
                  opacity: isDisabled ? 0.45 : 1,
                  cursor: isDisabled ? "not-allowed" : "pointer",
                }}
              >
                {t(q.key)}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        disabled={busy !== null || slideCount === 0}
        onClick={() => setConfirmOpen(true)}
        style={primaryBtn}
      >
        {busy === "regen"
          ? t("editor.copyTab.busy")
          : t("editor.aiTab.regenerateAll", { count: slideCount })}
      </button>

      <RegenerateConfirmDialog
        open={confirmOpen}
        slideCount={slideCount}
        stylePrompt={prompt}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void runAssets({ regenerateAll: true, stylePrompt: prompt }, "regen");
        }}
      />

      {msg && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-soft)",
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}

const chipBtn: React.CSSProperties = {
  padding: "5px 10px",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  border: "1px solid var(--border, rgba(0,0,0,0.12))",
  background: "transparent",
  color: "var(--text-soft)",
  borderRadius: 999,
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  padding: "10px 14px",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  border: "1px solid var(--accent, #2a3a4a)",
  background: "var(--accent, #2a3a4a)",
  color: "var(--bg, #fff)",
  borderRadius: 6,
  cursor: "pointer",
  boxShadow: "0 1px 2px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)",
  transition: "transform 0.1s, box-shadow 0.15s",
};

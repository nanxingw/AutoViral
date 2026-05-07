import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useEditor } from "../../store";
import { loadCarousel } from "../../services/carousel";
import { useT, type MessageKey } from "@/i18n/useT";

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
  const slideCount = car?.slides.length ?? 0;
  const t = useT();

  /**
   * Poll carousel.updatedAt every 5s for up to 60s after triggering an
   * agent run. When the file mtime moves past the snapshot we took at
   * dispatch time, the agent has rewritten carousel.yaml — pull the
   * fresh state into the store so the canvas refreshes without a
   * manual reload.
   */
  const watchForCarouselUpdate = async (
    sinceISO: string,
    timeoutMs = 60_000,
  ) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 5_000));
      try {
        const next = await loadCarousel(workId);
        if (next && next.updatedAt > sinceISO) {
          reload(next);
          setMsg(t("editor.aiTab.msgUpdated"));
          return;
        }
      } catch {
        // ignore transient fetch failures, keep polling.
      }
    }
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
          rows={4}
          placeholder={t("editor.aiTab.stylePlaceholder")}
          style={{
            width: "100%",
            padding: 8,
            border: "1px solid var(--border, rgba(0,0,0,0.12))",
            borderRadius: 6,
            background: "transparent",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            resize: "vertical",
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
          {QUICK_STYLES.map((q) => (
            <button
              key={q.prompt}
              type="button"
              onClick={() => runAssets({ stylePrompt: q.prompt }, "quick")}
              disabled={busy !== null}
              style={chipBtn}
            >
              {t(q.key)}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={busy !== null || slideCount === 0}
        onClick={() =>
          runAssets({ regenerateAll: true, stylePrompt: prompt }, "regen")
        }
        style={primaryBtn}
      >
        {busy === "regen"
          ? t("editor.copyTab.busy")
          : t("editor.aiTab.regenerateAll", { count: slideCount })}
      </button>

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
  padding: "8px 14px",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  border: "1px solid var(--accent, #2a3a4a)",
  background: "var(--accent, #2a3a4a)",
  color: "var(--bg, #fff)",
  borderRadius: 4,
  cursor: "pointer",
};

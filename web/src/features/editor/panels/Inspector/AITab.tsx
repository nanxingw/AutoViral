import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { useEditor } from "../../store";

const QUICK_STYLES = [
  "minimal editorial",
  "soft pastel",
  "neon cyberpunk",
  "earthy zine",
  "high-contrast noir",
  "sun-bleached film",
];

export function AITab({ workId }: { workId: string }) {
  const car = useEditor((s) => s.car);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<null | "regen" | "quick">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const slideCount = car?.slides.length ?? 0;

  const runAssets = async (
    input: Record<string, unknown>,
    label: "regen" | "quick",
  ) => {
    setBusy(label);
    setMsg(null);
    try {
      await apiFetch(`/api/works/${workId}/invoke`, {
        method: "POST",
        body: { module: "assets", input },
      });
      setMsg("queued");
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
          Style prompt
        </label>
        <textarea
          aria-label="Style prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="e.g. soft analog film, beige tones, hand-drawn type"
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
          Quick styles
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {QUICK_STYLES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => runAssets({ stylePrompt: q }, "quick")}
              disabled={busy !== null}
              style={chipBtn}
            >
              {q}
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
        {busy === "regen" ? "..." : `Regenerate all ${slideCount} slides`}
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

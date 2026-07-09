import { useComposition } from "../../store";
import { useT } from "@/i18n/useT";
import { FPS_VALUES } from "@shared/composition";

/**
 * PRD-0011 F3 — canvas-fps segmented control, docked in the TweaksPanel next
 * to PlatformPresetSection (same section/heading shape). Four canonical
 * values only (24/25/30/60 — FPS_VALUES, the single source shared with the
 * `setFps` op / bridge / CLI). No Reframe-style confirmation dialog: fps is
 * data-lossless and instantly reversible (PRD Implementation Decisions), so
 * clicking a value commits immediately through `setFps` — a pure local immer
 * write (see store.ts) that lands via the existing autosave debounce, same
 * as every other human-UI composition edit.
 *
 * Segmented-control markup/styling mirrors PreviewPanel's existing aspect-
 * ratio control (role="group" + aria-pressed + --accent-lo/-hi tokens) —
 * the closest in-repo precedent for "four-way toggle over a canvas param".
 */
export function FpsSection() {
  const t = useT();
  const fps = useComposition((s) => s.comp?.fps);
  const setFps = useComposition((s) => s.setFps);

  return (
    <section
      style={{
        padding: "12px 16px",
        borderTop: "1px solid var(--glass-border)",
      }}
    >
      <h4
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontFamily: "var(--font-mono)",
          color: "var(--text-dim)",
          margin: "0 0 8px",
        }}
      >
        {t("studio.fpsSection.heading")}
      </h4>
      <div
        role="group"
        aria-label={t("studio.fpsSection.ariaLabel")}
        style={{ display: "flex", gap: 4 }}
      >
        {FPS_VALUES.map((v) => {
          const active = fps === v;
          return (
            <button
              key={v}
              type="button"
              data-testid={`fps-option-${v}`}
              aria-pressed={active}
              onClick={() => setFps(v)}
              style={{
                flex: 1,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.02em",
                padding: "5px 4px",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                border: "1px solid var(--glass-border)",
                color: active ? "var(--accent-hi)" : "var(--text-dimmer)",
                background: active ? "var(--accent-lo)" : "transparent",
              }}
            >
              {v}
            </button>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          color: "var(--text-dimmer)",
        }}
      >
        24 {t("studio.fpsSection.recommendedSuffix")}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          lineHeight: 1.5,
          color: "var(--text-dim)",
        }}
      >
        {t("studio.fpsSection.hint")}
      </div>
    </section>
  );
}

import { ThemeSection } from "./ThemeSection";

/**
 * Studio v4.0 floating Tweaks overlay.
 *
 * Mounted as a fixed-position glass card in the top-right corner of the
 * viewport (mockup: autoviral design/studio-app.jsx:514-525). Contains
 * only the Theme + Accent controls in this batch — the legacy
 * LayerSection / CompositionSection / DensitySection are kept on disk
 * with @deprecated JSDoc and may be re-introduced as a per-clip
 * inspector in Phase 8.
 */
export function TweaksPanel() {
  return (
    <aside
      data-testid="tweaks-panel"
      aria-label="Tweaks"
      style={{
        position: "fixed",
        top: 76,
        right: 14,
        width: 240,
        zIndex: 50,
        background: "var(--surface-1)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
        border: "1px solid var(--glass-border)",
        borderRadius: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}
    >
      <ThemeSection />
    </aside>
  );
}

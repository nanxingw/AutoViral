import { ThemeSection } from "./ThemeSection";

export function TweaksPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose?: () => void;
}) {
  if (!open) return null;
  return (
    <aside
      data-testid="tweaks-panel"
      aria-label="Settings"
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
      {onClose ? (
        <button
          type="button"
          data-bare
          aria-label="Close settings"
          data-testid="tweaks-close"
          onClick={onClose}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 22,
            height: 22,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "var(--text-dim)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            zIndex: 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      ) : null}
      <ThemeSection />
    </aside>
  );
}

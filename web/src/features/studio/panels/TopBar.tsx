import { useComposition } from "../store";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@/stores/theme";

export function TopBar({
  workId,
  onExport,
  savedAt,
  onToggleSettings,
  settingsOpen,
}: {
  workId: string;
  onExport: () => void;
  savedAt: string | null;
  onToggleSettings?: () => void;
  settingsOpen?: boolean;
}) {
  const navigate = useNavigate();
  const comp = useComposition((s) => s.comp);
  const { theme, toggle } = useTheme();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 18px",
        height: "100%",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        data-bare
        onClick={() => navigate("/")}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--text-dim)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div style={{ width: 1, height: 20, background: "var(--divider)", flexShrink: 0 }} />

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flex: 1, minWidth: 0, overflow: "hidden" }}>
        <span
          style={{
            fontFamily: "var(--font-editorial)",
            fontSize: 22,
            fontStyle: "italic",
            color: "var(--accent)",
            letterSpacing: "-0.02em",
            flexShrink: 0,
          }}
        >
          Autoviral
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-dimmer)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          Studio · v4.0
        </span>
        <div style={{ width: 1, height: 14, background: "var(--divider)", margin: "0 8px", flexShrink: 0 }} />
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--text)",
            letterSpacing: "-0.015em",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {comp?.id ?? workId}
        </span>
      </div>

      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: savedAt ? "var(--status-done)" : "var(--text-dimmer)",
          flexShrink: 0,
        }}
      >
        {savedAt ? `SAVED · ${savedAt}` : "UNSAVED"}
      </span>

      <div style={{ width: 1, height: 20, background: "var(--divider)", flexShrink: 0 }} />

      <button
        type="button"
        data-bare
        onClick={toggle}
        aria-label="Toggle theme"
        title="Theme"
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          border: "1px solid var(--glass-border)",
          background: "var(--surface-0)",
          color: "var(--text-dim)",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {theme === "dark" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        )}
      </button>

      {onToggleSettings ? (
        <button
          type="button"
          data-bare
          onClick={onToggleSettings}
          aria-label="Toggle settings"
          aria-pressed={settingsOpen ? true : false}
          data-testid="settings-toggle"
          title="Settings"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid var(--glass-border)",
            background: settingsOpen ? "var(--surface-1)" : "var(--surface-0)",
            color: settingsOpen ? "var(--accent)" : "var(--text-dim)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      ) : null}

      <button
        type="button"
        data-bare
        onClick={onExport}
        style={{
          padding: "7px 14px",
          borderRadius: 9,
          fontSize: 12,
          fontWeight: 600,
          border: "1px solid var(--accent-hi)",
          background: "linear-gradient(180deg, var(--accent-hi), var(--accent))",
          color: "var(--accent-fg)",
          cursor: "pointer",
          letterSpacing: "-0.005em",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          boxShadow: "0 4px 16px var(--accent-glow)",
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
        导出
      </button>
    </div>
  );
}

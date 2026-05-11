import { useEffect, useRef } from "react";
import { useSettingsPanelStore } from "@/stores/settings";
import { useModalFocus } from "@/hooks/useModalFocus";
import { useT } from "@/i18n/useT";
import styles from "./SettingsPanel.module.css";

export function SettingsPanel() {
  const open = useSettingsPanelStore((s) => s.open);
  const closePanel = useSettingsPanelStore((s) => s.closePanel);
  const t = useT();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useModalFocus(open, panelRef);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      data-testid="settings-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePanel();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        ref={panelRef}
      >
        <header className={styles.header}>
          <h2>{t("settings.title")}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t("settings.close")}
            onClick={closePanel}
          >
            ×
          </button>
        </header>
        <div className={styles.body}>
          {/* Sections added in Task 6+ */}
        </div>
      </div>
    </div>
  );
}

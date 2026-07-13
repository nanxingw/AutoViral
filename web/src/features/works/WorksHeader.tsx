import clsx from "clsx";
import { Link } from "react-router-dom";
import { useT } from "@/i18n/useT";
import { useSettingsPanelStore } from "@/stores/settings";
import { Glass } from "@/ui/Glass";
import { IconButton } from "@/ui/IconButton";
import { LocaleToggle } from "@/ui/LocaleToggle";
import { ThemeToggle } from "@/ui/ThemeToggle";
import styles from "./WorksHeader.module.css";

declare global {
  interface Window {
    autoviralDesktop?: { isDesktop?: boolean; version?: string; platform?: string };
  }
}

export function WorksHeader() {
  const t = useT();
  const openPanel = useSettingsPanelStore((state) => state.openPanel);
  const isMacDesktop =
    typeof window !== "undefined" &&
    window.autoviralDesktop?.isDesktop === true &&
    window.autoviralDesktop?.platform === "darwin";

  return (
    <header className={styles.outer}>
      <Glass
        data-testid="works-header-surface"
        className={clsx(styles.inner, isMacDesktop && styles.macDrag)}
      >
        <Link to="/" className={styles.brand} aria-label={t("worksHeader.brand")}>
          <span className={styles.logo} aria-hidden="true">A</span>
          <span className={styles.brandLines}>
            <span className={styles.brandTitle}>{t("worksHeader.brand")}</span>
            <span className={styles.brandTag}>{t("worksHeader.versionTag")}</span>
          </span>
        </Link>

        <div className={styles.controls}>
          <LocaleToggle />
          <ThemeToggle />
          <IconButton
            size="lg"
            variant="surface"
            aria-label={t("worksHeader.settings")}
            title={t("worksHeader.settings")}
            onClick={() => openPanel()}
          >
            <GearIcon />
          </IconButton>
        </div>
      </Glass>
    </header>
  );
}

function GearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

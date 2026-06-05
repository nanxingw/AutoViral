import { useEffect } from "react";
import clsx from "clsx";
import { Link, useLocation } from "react-router-dom";
import { Glass } from "./Glass";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";
import { useT, type MessageKey } from "@/i18n/useT";
import { useSettingsPanelStore } from "@/stores/settings";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import styles from "./TopNav.module.css";

declare global {
  interface Window {
    autoviralDesktop?: { isDesktop?: boolean; version?: string; platform?: string };
  }
}

// macOS Electron uses titleBarStyle:"hiddenInset" (desktop/main.ts) — a chrome-less
// window whose ONLY draggable surface must be declared by the renderer via CSS
// `-webkit-app-region: drag`. We make the TopNav glass bar that handle (.macDrag in
// TopNav.module.css), gated to mac-desktop so the browser build and Windows (which
// keeps its native title bar) are untouched. app-region is a pure hit-testing hint —
// zero visual change to the editorial-glass look.
const isMacDesktop =
  typeof window !== "undefined" &&
  window.autoviralDesktop?.isDesktop === true &&
  window.autoviralDesktop?.platform === "darwin";

const TABS: Array<{ to: string; key: MessageKey }> = [
  { to: "/", key: "topnav.works" },
  { to: "/explore", key: "topnav.explore" },
  { to: "/analytics", key: "topnav.analytics" },
];

export function TopNav() {
  const { pathname } = useLocation();
  // Works tab matches both "/" and "/works" (the alias route added in Round 1
  // so that "/works" doesn't 404 on direct navigation). Without the alias
  // check, the tab silently failed to highlight when user landed on /works,
  // breaking the "where am I" affordance.
  const active = (to: string) =>
    to === "/"
      ? pathname === "/" || pathname === "/works"
      : pathname.startsWith(to);
  const t = useT();
  const openPanel = useSettingsPanelStore((s) => s.openPanel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openPanel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openPanel]);

  return (
    <>
      <header className={clsx(styles.outer, isMacDesktop && styles.macDrag)}>
        <Glass className={styles.inner}>
          <Link to="/" className={styles.brand}>
            <div className={styles.logo}>A</div>
            <div className={styles.brandLines}>
              <span className={styles.brandTitle}>Autoviral</span>
              <span className={styles.brandTag}>{t("topnav.versionTag")}</span>
            </div>
          </Link>
          <nav className={styles.tabs}>
            {TABS.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                className={styles.tab}
                aria-current={active(tab.to) ? "page" : undefined}
              >
                {t(tab.key)}
              </Link>
            ))}
          </nav>
          <div className={styles.right}>
            <LocaleToggle />
            <ThemeToggle />
            <button
              type="button"
              className={styles.gearBtn}
              aria-label={t("topnav.settings")}
              onClick={() => openPanel()}
            >
              <GearIcon />
            </button>
          </div>
        </Glass>
      </header>
      <SettingsPanel />
    </>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

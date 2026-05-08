import { Link, useLocation } from "react-router-dom";
import { Glass } from "./Glass";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";
import { useT, type MessageKey } from "@/i18n/useT";
import styles from "./TopNav.module.css";

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

  return (
    <header className={styles.outer}>
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
        </div>
      </Glass>
    </header>
  );
}

import { Link, useLocation } from "react-router-dom";
import { Glass } from "./Glass";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./TopNav.module.css";

const TABS = [
  { to: "/", label: "Works · 作品" },
  { to: "/explore", label: "Explore · 灵感" },
  { to: "/analytics", label: "Analytics · 数据" },
];

export function TopNav() {
  const { pathname } = useLocation();
  const active = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));

  return (
    <header className={styles.outer}>
      <Glass className={styles.inner}>
        <Link to="/" className={styles.brand}>
          <div className={styles.logo}>A</div>
          <div className={styles.brandLines}>
            <span className={styles.brandTitle}>Autoviral</span>
            <span className={styles.brandTag}>v3 · DESIGN</span>
          </div>
        </Link>
        <nav className={styles.tabs}>
          {TABS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className={styles.tab}
              aria-current={active(t.to) ? "page" : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className={styles.right}>
          <ThemeToggle />
        </div>
      </Glass>
    </header>
  );
}

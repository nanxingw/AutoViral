import { Link, useLocation } from "react-router-dom";
import { useT } from "@/i18n/useT";

/**
 * Catch-all 404 — editorial sketch instead of the React Router default
 * blank screen. Shows the URL the user tried to follow + a one-click
 * route home. No retry / no auto-redirect: a wrong URL deserves a
 * deliberate user action.
 */
export default function NotFound() {
  const t = useT();
  const location = useLocation();
  return (
    <main className="page" style={{ padding: "96px 0 48px", maxWidth: 880 }}>
      <div
        style={{
          fontFamily: "Instrument Serif, var(--font-serif)",
          fontStyle: "italic",
          fontSize: 200,
          lineHeight: 0.9,
          color: "var(--text-dimmer)",
          letterSpacing: "-0.02em",
          marginBottom: 16,
        }}
        aria-hidden
      >
        {t("notFound.code")}
      </div>
      <h1
        style={{
          fontSize: 36,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          margin: "0 0 12px",
          color: "var(--text)",
        }}
      >
        {t("notFound.title")}
      </h1>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.7,
          color: "var(--text-dim)",
          maxWidth: 560,
          margin: "0 0 24px",
        }}
      >
        {t("notFound.body")}
      </p>
      <code
        style={{
          display: "inline-block",
          padding: "4px 10px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-dimmer)",
          background: "var(--surface-1)",
          border: "1px dashed var(--glass-border)",
          borderRadius: 4,
          marginBottom: 28,
          maxWidth: "100%",
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        {location.pathname}
      </code>
      <div>
        <Link
          to="/"
          style={{
            display: "inline-block",
            padding: "10px 16px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.06em",
            border: "1px solid var(--accent)",
            background: "var(--accent-glow)",
            color: "var(--accent-hi)",
            borderRadius: 6,
            textDecoration: "none",
          }}
        >
          {t("notFound.backHome")}
        </Link>
      </div>
    </main>
  );
}

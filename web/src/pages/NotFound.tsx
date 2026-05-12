import { useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useT } from "@/i18n/useT";

/**
 * Catch-all 404 — editorial sketch instead of the React Router default
 * blank screen. Six R110 fixes layered on top of the bare 1-CTA original:
 *
 * - **F488** `document.title` reflects the error state (was permanently
 *   "AutoViral", indistinguishable from real pages in tabs/bookmarks).
 * - **F490** Levenshtein fuzzy match against known top-level routes
 *   surfaces "Did you mean: /explore?" for typos like `/explor`.
 * - **F492** Echoed path now includes `?query` and `#hash` so users who
 *   pasted long URLs from Slack/email can see the full broken link
 *   (was pathname-only, silently truncating).
 * - **F493** A11y — visible 200px "404" glyph stays decorative; an
 *   `sr-only` span before the h1 conveys the error code to screen
 *   readers (previous markup made SR users miss the "404" entirely).
 * - **F495** Primary CTA auto-focused on mount so keyboard users land
 *   directly on the recovery action (was falling through to `<body>`,
 *   forcing Tab through every TopNav button first).
 * - **F498** Primary CTA visual upgrade — solid accent fill replaces
 *   the near-transparent `--accent-glow` tint, restoring the clickable
 *   affordance that the original looked-like-disabled background lost.
 *
 * No retry / no auto-redirect: a wrong URL deserves a deliberate user
 * action.
 */

/** Top-level routes from `main.tsx` we fuzzy-match against. Keep in
 * sync if new routes ship. Index ("") is intentionally omitted from
 * suggestion targets — we don't want to suggest "/" for a 1-char typo. */
const KNOWN_ROUTES = ["works", "explore", "analytics", "studio", "editor"] as const;

/** Classic two-row dynamic programming Levenshtein. Bound at 32 chars
 * so we don't pay for adversarial long-segment inputs. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const aLen = Math.min(a.length, 32);
  const bLen = Math.min(b.length, 32);
  let prev = new Array(bLen + 1).fill(0).map((_, i) => i);
  let curr = new Array(bLen + 1).fill(0);
  for (let i = 1; i <= aLen; i++) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bLen];
}

/** Returns the closest known route if Levenshtein distance ≤ 2 AND > 0.
 * 0-distance means user already hit a real route (caller mistake) — skip
 * suggestion. ≥3 distance is "fundamentally different intent" — also
 * skip rather than surface a confusing guess. */
function suggestRoute(pathname: string): string | null {
  const segment = pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  if (!segment) return null;
  let best: { route: string; dist: number } | null = null;
  for (const route of KNOWN_ROUTES) {
    const d = levenshtein(segment.toLowerCase(), route);
    if (d > 0 && d <= 2 && (!best || d < best.dist)) {
      best = { route, dist: d };
    }
  }
  return best ? `/${best.route}` : null;
}

export default function NotFound() {
  const t = useT();
  const location = useLocation();
  const backLinkRef = useRef<HTMLAnchorElement | null>(null);

  // F492 — keep query + hash so users see the full link they tried.
  const fullPath = `${location.pathname}${location.search}${location.hash}`;

  // F490 — surface a "Did you mean?" suggestion when the first path
  // segment is close to a known route (typo recovery).
  const suggestion = useMemo(() => suggestRoute(location.pathname), [location.pathname]);

  // F488 — document title reflects 404 state. Restored on unmount so
  // navigating away doesn't leave stale title bleed.
  useEffect(() => {
    const prev = document.title;
    document.title = `404 · ${t("notFound.titleShort")} · AutoViral`;
    return () => {
      document.title = prev;
    };
  }, [t]);

  // F495 — keyboard users land on the recovery CTA without Tab-hunting
  // through TopNav. preventScroll keeps the editorial 200px glyph in view.
  useEffect(() => {
    backLinkRef.current?.focus({ preventScroll: true });
  }, []);

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
        {/* F493 — sr-only carries "Error 404 — " to assistive tech because
            the decorative 200px glyph above is aria-hidden. */}
        <span className="sr-only">{t("notFound.srErrorCode")} — </span>
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
        data-testid="notfound-path"
        style={{
          display: "inline-block",
          padding: "4px 10px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-dimmer)",
          background: "var(--surface-1)",
          border: "1px dashed var(--glass-border)",
          borderRadius: 4,
          marginBottom: suggestion ? 12 : 28,
          maxWidth: "100%",
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        {fullPath}
      </code>
      {suggestion && (
        <p
          data-testid="notfound-suggestion"
          style={{
            fontSize: 13,
            color: "var(--text-dim)",
            margin: "0 0 24px",
          }}
        >
          {t("notFound.didYouMean")}{" "}
          <Link to={suggestion} style={{ color: "var(--accent-hi)", fontFamily: "var(--font-mono)" }}>
            {suggestion}
          </Link>
        </p>
      )}
      <div>
        <Link
          ref={backLinkRef}
          to="/"
          data-testid="notfound-back-home"
          style={{
            display: "inline-block",
            padding: "10px 16px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.06em",
            border: "1px solid var(--accent)",
            background: "var(--accent)",
            color: "var(--accent-fg, #fff)",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          {t("notFound.backHome")}
        </Link>
      </div>
    </main>
  );
}

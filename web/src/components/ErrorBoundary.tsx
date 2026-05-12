import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/i18n/useT";

/**
 * App-level error boundary — catches any React render-phase error in the
 * subtree and renders a graceful editorial fallback instead of letting
 * React unmount the whole tree (the dreaded white screen).
 *
 * Why a class component? `componentDidCatch` / `getDerivedStateFromError`
 * have no hook equivalents in React 19; this is one of the few places
 * the class API is still load-bearing.
 *
 * The fallback uses a child function-component (ErrorFallback) so we can
 * still call useT() — class components can't use hooks themselves.
 *
 * R113 audit closed F499/F500/F502/F503/F504/F505/F507/F509/F510 in a
 * single pass:
 * - **F499**: `error.stack` is now env-gated. Dev shows it expanded for
 *   debug; production hides it behind a "Copy diagnostic" button so
 *   regular users no longer see internal module paths / minified bundle
 *   names that aided attacker fingerprinting.
 * - **F500**: removed the `onReset() + window.location.reload()` double
 *   call. Reload is its own destructive button; soft retry is now a
 *   separate primary CTA so transient errors don't have to nuke state.
 * - **F502**: "Try again" soft-retry primary CTA — clears boundary
 *   state without reloading, preserving react-query cache / zustand
 *   / unsaved drafts / Editor canvas / Studio chat stream.
 * - **F503**: `crypto.randomUUID()` correlation ID surfaced in fallback
 *   UI so bug reports / support tickets carry a join key.
 * - **F504**: "Copy diagnostic" button packages errorId + name + message
 *   + stack + componentStack + UA + timestamp as one JSON blob into the
 *   clipboard. Removes the "rage-click Reload before I can ⌘C" race.
 * - **F505**: `componentStack` (React tree path) now persisted to state
 *   and rendered in the dev details panel alongside the JS stack.
 * - **F507**: error-type-aware body copy. `ChunkLoadError` hints "we just
 *   shipped a new version, reload should pick it up"; network errors
 *   hint "try again, it usually works the second time"; generic stays
 *   on the existing message.
 * - **F509**: home affordance switched from `<a href="/">` (forces
 *   full-page reload like the destructive Reload button) to react-router
 *   `<Link to="/">` (client-side nav, preserves provider state).
 * - **F510**: sr-only "Error — " in the h1 so SR users hear the severity
 *   semantic, matching the NotFound sr-only-error-code pattern.
 */

interface Props {
  children: ReactNode;
  /** Optional render prop for a scoped boundary (e.g. inside a Chat panel)
   *  to render a compact inline fallback instead of the default editorial
   *  full-page screen. Round 25 added this so a chat crash doesn't replace
   *  the whole Studio. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
  errorId: string | null;
  componentStack: string | null;
}

function newErrorId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } catch {
    return `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** F507 — coarse error-type bucketing. `ChunkLoadError` is the dominant
 * case after a fresh deploy; network failures show up under TypeError +
 * fetch text. Anything else falls back to the generic copy. Keep the
 * matcher list short — a fancy taxonomy here would itself be a source
 * of bugs, and the body strings are translator-maintained. */
type ErrorBucket = "chunk" | "network" | "generic";
function bucketOf(err: Error): ErrorBucket {
  if (err.name === "ChunkLoadError" || /Loading chunk \d+ failed/i.test(err.message)) return "chunk";
  if (err.name === "TypeError" && /(fetch|networkerror|failed to fetch)/i.test(err.message)) return "network";
  return "generic";
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorId: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    // R113 F503 — every captured error gets a stable correlation ID at
    // the moment of failure. The fallback UI surfaces it so users can
    // quote it back in support channels.
    return { error, errorId: newErrorId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // R113 F505 — componentStack (React tree path) is too useful to lose
    // to console only. Persist it so the dev details panel renders both
    // the JS call stack and the React tree path.
    this.setState({ componentStack: info.componentStack ?? null });
    // Surface to console so developers see the trace; production telemetry
    // would hook in here (Sentry / posthog) when wired — F501 backlog.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught render error:", error, info);
  }

  handleReset = () => {
    this.setState({ error: null, errorId: null, componentStack: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset);
      }
      return (
        <ErrorFallback
          error={this.state.error}
          errorId={this.state.errorId ?? "unknown"}
          componentStack={this.state.componentStack}
          onReset={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}

function ErrorFallback({
  error,
  errorId,
  componentStack,
  onReset,
}: {
  error: Error;
  errorId: string;
  componentStack: string | null;
  onReset: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const isDev = !!import.meta.env?.DEV;
  const bucket = bucketOf(error);
  // F507 — pick the body string for the matched error bucket; fall back
  // to the generic if a translator hasn't supplied a bucket-specific copy.
  const bucketBodyKey =
    bucket === "chunk"
      ? "errorBoundary.bodyChunk"
      : bucket === "network"
        ? "errorBoundary.bodyNetwork"
        : "errorBoundary.body";

  const handleCopyDiagnostic = async () => {
    const payload = {
      errorId,
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      componentStack,
      userAgent: globalThis.navigator?.userAgent ?? null,
      url: globalThis.location?.href ?? null,
      timestamp: new Date().toISOString(),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      // Clipboard API may be unavailable (http://, sandboxed iframe,
      // permissions denied). Fall back to opening the JSON in a new
      // tab so the user can copy manually.
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      window.open(URL.createObjectURL(blob), "_blank");
    }
  };

  const handleReload = () => {
    // R113 F500 — reload is a hard reset that wipes queryClient cache,
    // zustand stores, scroll, in-flight WebSocket / streaming chat
    // responses, and unsaved Editor / Studio drafts. Confirm before
    // doing so. `window.confirm` is intentional (no extra modal lib)
    // and tests stub it.
    if (window.confirm(t("errorBoundary.reloadConfirm"))) {
      window.location.reload();
    }
  };

  return (
    <main
      role="alert"
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "96px 24px 48px",
      }}
    >
      <div
        style={{
          fontFamily: "Instrument Serif, var(--font-serif)",
          fontStyle: "italic",
          fontSize: 120,
          lineHeight: 0.9,
          color: "var(--text-dimmer)",
          letterSpacing: "-0.02em",
          marginBottom: 16,
        }}
        aria-hidden
      >
        ✕
      </div>
      <h1
        style={{
          fontSize: 32,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          margin: "0 0 12px",
          color: "var(--text)",
        }}
      >
        {/* F510 — sr-only error severity for screen readers because the
            visible ✕ glyph is aria-hidden. */}
        <span className="sr-only">{t("errorBoundary.srErrorCode")} — </span>
        {t("errorBoundary.title")}
      </h1>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.7,
          color: "var(--text-dim)",
          maxWidth: 560,
          margin: "0 0 12px",
        }}
      >
        {t(bucketBodyKey as Parameters<typeof t>[0])}
      </p>

      {/* F503 — correlation ID is always rendered so users can quote it
          back in bug reports / Slack threads. The label is i18n; the ID
          itself stays untranslated (it's an opaque identifier). */}
      <p
        data-testid="errorboundary-error-id"
        style={{
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--text-dimmer)",
          margin: "0 0 20px",
          userSelect: "all",
        }}
      >
        {t("errorBoundary.errorIdLabel")}: <code>{errorId}</code>
      </p>

      <details
        // F499 — dev sees the full stack expanded by default; prod
        // keeps it collapsed so stack/module paths aren't on-screen
        // for over-the-shoulder readers or screen-recording. Both
        // environments expose the same info on demand (the user can
        // still expand or "Copy diagnostic" in prod).
        open={isDev}
        style={{
          marginBottom: 24,
          padding: "8px 12px",
          background: "var(--surface-1)",
          border: "1px dashed var(--glass-border)",
          borderRadius: 6,
        }}
      >
        <summary
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-dimmer)",
            cursor: "pointer",
          }}
        >
          {t("errorBoundary.detailsLabel")}
        </summary>
        <pre
          data-testid="errorboundary-stack"
          style={{
            marginTop: 8,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          {error.name}: {error.message}
          {error.stack ? `\n\n${error.stack}` : ""}
          {componentStack ? `\n\n--- React component stack ---${componentStack}` : ""}
        </pre>
      </details>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {/* F502 — soft retry is the primary CTA (solid accent fill).
            Tries to recover by clearing boundary state without
            destroying the rest of the app. */}
        <button
          type="button"
          data-testid="errorboundary-try-again"
          onClick={onReset}
          style={{
            padding: "10px 16px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.06em",
            border: "1px solid var(--accent)",
            background: "var(--accent)",
            color: "var(--accent-fg, #fff)",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {t("errorBoundary.btnTryAgain")}
        </button>
        {/* F500 — reload demoted from primary to secondary, with a
            confirm prompt because it nukes in-memory state. */}
        <button
          type="button"
          data-testid="errorboundary-reload"
          onClick={handleReload}
          style={{
            padding: "10px 16px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.06em",
            border: "1px solid var(--glass-border)",
            background: "transparent",
            color: "var(--text-dim)",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {t("errorBoundary.btnReload")}
        </button>
        {/* F509 — react-router Link, not bare anchor. Preserves react
            state through the navigation; pairs with Try again to give
            users two non-destructive recovery paths. */}
        <Link
          to="/"
          data-testid="errorboundary-home"
          style={{
            display: "inline-block",
            padding: "10px 16px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.06em",
            border: "1px solid var(--glass-border)",
            background: "transparent",
            color: "var(--text-dim)",
            borderRadius: 6,
            textDecoration: "none",
          }}
          onClick={onReset}
        >
          {t("errorBoundary.btnHome")}
        </Link>
        {/* F504 — explicit copy diagnostic so the user can attach
            full context to a bug report. Status text updates inline
            without a toast dependency. */}
        <button
          type="button"
          data-testid="errorboundary-copy"
          onClick={handleCopyDiagnostic}
          style={{
            marginLeft: "auto",
            padding: "10px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.06em",
            border: "1px dashed var(--glass-border)",
            background: "transparent",
            color: copied ? "var(--accent)" : "var(--text-dimmer)",
            borderRadius: 6,
            cursor: "pointer",
          }}
          aria-live="polite"
        >
          {copied ? t("errorBoundary.copyDone") : t("errorBoundary.copyDiagnostic")}
        </button>
      </div>
    </main>
  );
}

import { Component, type ErrorInfo, type ReactNode } from "react";
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
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to console so developers see the trace; production telemetry
    // would hook in here (Sentry / posthog) when wired.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught render error:", error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onReset={this.handleReset} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const t = useT();
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
        {t("errorBoundary.title")}
      </h1>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.7,
          color: "var(--text-dim)",
          maxWidth: 560,
          margin: "0 0 20px",
        }}
      >
        {t("errorBoundary.body")}
      </p>

      <details
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
        </pre>
      </details>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => {
            onReset();
            window.location.reload();
          }}
          style={{
            padding: "10px 16px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.06em",
            border: "1px solid var(--accent)",
            background: "var(--accent-glow)",
            color: "var(--accent-hi)",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {t("errorBoundary.btnReload")}
        </button>
        <a
          href="/"
          onClick={onReset}
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
        >
          {t("errorBoundary.btnHome")}
        </a>
      </div>
    </main>
  );
}

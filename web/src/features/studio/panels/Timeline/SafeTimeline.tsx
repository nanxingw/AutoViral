import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useT } from "@/i18n/useT";
import { Timeline } from "./index";

/**
 * Round 30 — scoped error boundary around Timeline. Same pattern as
 * R25's SafeChatPanel (chat). Timeline is a high-risk subtree:
 *   - Renders N clips (each with a src URL that can 404 / drift on
 *     YAML mutation)
 *   - Decodes waveforms (Web Audio decode failure on malformed audio)
 *   - Reads keyframe arrays + draws splines (any NaN value blows
 *     react-konva render math)
 *   - Subscribes to a complex zustand drag pipeline with mid-flight
 *     state (snap math, multi-track moves)
 *
 * Without isolation a clip-level crash bubbles to the route boundary
 * and replaces the entire Studio — user loses Preview / Sidebar / Chat
 * just because one bad clip serialised wrong. Scoped fallback keeps
 * the rest of the page working so the user can still navigate / chat
 * with the agent / inspect raw composition.yaml to fix.
 */
export function SafeTimeline() {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <TimelineCrashFallback error={error} onReset={reset} />
      )}
    >
      <Timeline />
    </ErrorBoundary>
  );
}

function TimelineCrashFallback({
  error,
  onReset,
}: {
  error: Error;
  onReset: () => void;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "20px 24px",
        background: "var(--surface-1)",
        borderTop: "1px solid var(--glass-border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
        }}
      >
        <span
          style={{
            fontFamily: "Instrument Serif, var(--font-serif)",
            fontStyle: "italic",
            fontSize: 32,
            color: "var(--status-error, #d4756c)",
            letterSpacing: "-0.02em",
          }}
          aria-hidden
        >
          ✕
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--text)",
          }}
        >
          {t("studio.timeline.crashTitle")}
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.6,
          color: "var(--text-dim)",
          maxWidth: 640,
        }}
      >
        {t("studio.timeline.crashBody")}
      </div>
      <details
        style={{
          padding: "6px 8px",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-dimmer)",
          border: "1px dashed var(--glass-border)",
          borderRadius: 4,
          maxWidth: 720,
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {error.name}
        </summary>
        <pre
          style={{
            marginTop: 6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 120,
            overflow: "auto",
          }}
        >
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ""}
        </pre>
      </details>
      <button
        type="button"
        onClick={onReset}
        style={{
          alignSelf: "flex-start",
          padding: "6px 14px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.06em",
          border: "1px solid var(--accent)",
          background: "var(--accent-glow)",
          color: "var(--accent-hi)",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        {t("studio.timeline.crashReset")}
      </button>
    </div>
  );
}

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useT } from "@/i18n/useT";
import { ChatPanel, type ChatPanelProps } from "./index";

/**
 * Round 25 — scoped error boundary around ChatPanel. Chat is the highest-
 * risk subtree (markdown render, websocket race, agent output parsing,
 * user free-form input). Without isolation, a chat-internal crash bubbles
 * up to the route-level boundary and replaces the entire Studio/Editor
 * page — user loses their video editing context just because chat broke.
 *
 * The compact fallback renders a small alert inside the chat panel slot
 * so the surrounding panels (timeline, preview, inspector) keep working.
 * The reset button retries chat after the offending state clears.
 */
export function SafeChatPanel(props: ChatPanelProps) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => <ChatCrashFallback error={error} onReset={reset} />}
    >
      <ChatPanel {...props} />
    </ErrorBoundary>
  );
}

function ChatCrashFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const t = useT();
  return (
    <div
      role="alert"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "20px 18px",
        background: "var(--surface-1)",
        borderLeft: "1px solid var(--glass-border)",
      }}
    >
      <div
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
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: "var(--text)",
        }}
      >
        {t("chat.crashTitle")}
      </div>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.6,
          color: "var(--text-dim)",
        }}
      >
        {t("chat.crashBody")}
      </div>
      <details
        style={{
          padding: "6px 8px",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-dimmer)",
          border: "1px dashed var(--glass-border)",
          borderRadius: 4,
        }}
      >
        <summary style={{ cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase" }}>
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
        {t("chat.crashReset")}
      </button>
    </div>
  );
}

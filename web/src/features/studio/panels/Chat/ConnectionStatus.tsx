import type { WSState } from "@/lib/ws";
import { useT } from "@/i18n/useT";

// Persistent connection indicator for the chat header.
//
// Previously only the *failure* states rendered (a red "RECONNECTING…" badge);
// a healthy connection showed nothing, so there was no positive confirmation
// that the creative agent bridge was live. This renders in ALL three states so
// "connected" gets a steady green dot symmetric with the red failure badge:
//   open         → green steady dot   (stable, no motion)
//   connecting   → amber pulsing dot  (first connect / in progress)
//   reconnecting → red pulsing dot    (recovering from a dropped socket)

interface StateStyle {
  color: string;
  labelKey: "chat.wsConnected" | "chat.wsConnecting" | "chat.wsReconnecting";
  pulse: boolean;
}

const STATE_STYLE: Record<WSState, StateStyle> = {
  open: { color: "var(--status-done)", labelKey: "chat.wsConnected", pulse: false },
  connecting: { color: "var(--status-warn)", labelKey: "chat.wsConnecting", pulse: true },
  reconnecting: { color: "var(--status-error)", labelKey: "chat.wsReconnecting", pulse: true },
};

export function ConnectionStatus({ state }: { state: WSState }) {
  const t = useT();
  // Defensive: an unknown/undefined state (e.g. a partial socket mock or a
  // future WSState) must not crash the whole chat header — fall back to the
  // in-progress "connecting" look rather than indexing into `undefined`.
  const resolved: WSState = STATE_STYLE[state] ? state : "connecting";
  const s = STATE_STYLE[resolved];
  const title = resolved === "open" ? t("chat.wsConnectedTitle") : t("chat.wsReconnectingTitle");

  return (
    <span
      data-testid="chat-connection-status"
      data-state={resolved}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        marginLeft: 8,
        verticalAlign: "middle",
      }}
    >
      <span
        aria-hidden="true"
        className={s.pulse ? "pulse-dot" : undefined}
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: s.color,
          boxShadow: `0 0 5px ${s.color}`,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color: s.color,
          fontSize: 9,
          letterSpacing: "0.08em",
          fontFamily: "var(--font-mono)",
        }}
      >
        {t(s.labelKey)}
      </span>
    </span>
  );
}

// Phase 3 Task 3.9 — modal prompt that replies to `autoviral ask ...`.
//
// We open a SECOND WebSocket on /ws/bridge/:workId (in addition to the
// one in useBridgeEvents) so the inbound `approval-response` frame can
// travel back over the same channel that delivered `ui-ask`. The
// duplicate connection is intentional: keeping the modal self-contained
// means the rest of the Studio doesn't need to know about approval
// state, and the per-connection inbound parser on the server handles
// frames from any client identically.

import { useEffect, useRef, useState } from "react";

interface Ask {
  askId: string;
  message: string;
  kind: "yes-no" | "ok-cancel" | "input";
}

export function ApprovalPrompt({ workId }: { workId: string }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/ws/bridge/${workId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "ui-ask") setAsk(ev.payload as Ask);
      } catch {
        /* ignore */
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [workId]);

  if (!ask) return null;

  const answer = (a: "yes" | "no" | "cancelled") => {
    wsRef.current?.send(
      JSON.stringify({ t: "approval-response", askId: ask.askId, answer: a }),
    );
    setAsk(null);
  };

  const isYesNo = ask.kind === "yes-no";
  const primaryLabel = isYesNo ? "YES" : "OK";
  const secondaryLabel = isYesNo ? "NO" : "CANCEL";
  const secondaryAnswer: "no" | "cancelled" = isYesNo ? "no" : "cancelled";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="agent approval request"
      data-testid="approval-prompt"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 1000,
        backdropFilter: "blur(8px) saturate(140%)",
      }}
    >
      <div
        className="glass"
        style={{
          padding: 24,
          maxWidth: 420,
          minWidth: 320,
          borderRadius: 16,
          fontFamily: "var(--font-mono, monospace)",
          color: "var(--text, #fafaf7)",
          border: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
          background: "var(--surface-1, rgba(20,22,28,0.85))",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--text-dimmer, rgba(255,255,255,0.5))",
            letterSpacing: "0.06em",
            marginBottom: 8,
          }}
        >
          AGENT REQUEST
        </div>
        <div style={{ marginBottom: 20, fontSize: 14, lineHeight: 1.5 }}>
          {ask.message}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={() => answer(secondaryAnswer)}
            data-testid="approval-secondary"
            style={{
              padding: "8px 16px",
              fontFamily: "inherit",
              fontSize: 11,
              letterSpacing: "0.08em",
              background: "transparent",
              color: "var(--text-dimmer, rgba(255,255,255,0.6))",
              border: "1px solid var(--glass-border, rgba(255,255,255,0.15))",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {secondaryLabel}
          </button>
          <button
            onClick={() => answer("yes")}
            data-testid="approval-primary"
            style={{
              padding: "8px 16px",
              fontFamily: "inherit",
              fontSize: 11,
              letterSpacing: "0.08em",
              background: "var(--accent, #a8c5d6)",
              color: "var(--accent-fg, #0a0b0f)",
              border: "1px solid var(--accent, #a8c5d6)",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

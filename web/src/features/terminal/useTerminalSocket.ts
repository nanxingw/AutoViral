import { useEffect, useRef, useCallback, useState } from "react";

export type TerminalConnectionStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "gave-up";

export interface TerminalSocket {
  send: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
  ready: boolean;
  status: TerminalConnectionStatus;
  /** Force a reconnect attempt — used by the Reconnect button after
   *  the auto-reconnect schedule has been exhausted. */
  reconnect: () => void;
}

// Phase 5 Task 5.3 — auto-reconnect with bounded backoff.
//
// Schedule: 1s, 2s, 5s, then "gave-up" (UI shows a Reconnect button).
// Successful reconnect surfaces a `[reconnected]` line in the terminal
// via the onData callback so the user sees what happened. Intentional
// closes (component unmount, manual close) are NOT retried — tracked
// via an `intentRef` set during cleanup.
const BACKOFF_SCHEDULE_MS = [1000, 2000, 5000] as const;

export function useTerminalSocket(
  workId: string,
  onData: (data: string) => void,
): TerminalSocket {
  const wsRef = useRef<WebSocket | null>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const intentRef = useRef<"open" | "closed">("open");
  const attemptRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const everConnectedRef = useRef(false);

  const [status, setStatus] = useState<TerminalConnectionStatus>("connecting");

  // Stash the latest onData in a ref so the WebSocket factory doesn't
  // need to re-subscribe (and reconnect!) on every parent rerender.
  const onDataRef = useRef(onData);
  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  const connect = useCallback(() => {
    if (typeof WebSocket === "undefined") return;
    intentRef.current = "open";
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const ws = new WebSocket(`${proto}://${host}/ws/terminal/${workId}`);
    wsRef.current = ws;
    setStatus(everConnectedRef.current ? "reconnecting" : "connecting");

    ws.onopen = () => {
      const wasReconnect = everConnectedRef.current;
      readyRef.current = true;
      everConnectedRef.current = true;
      attemptRef.current = 0;
      setStatus("open");
      // Replay any queued sends that arrived while the socket was down.
      for (const q of queueRef.current) ws.send(q);
      queueRef.current = [];
      // Surface the reconnect in the terminal so users see why a fresh
      // shell prompt suddenly appeared after a network hiccup.
      if (wasReconnect) {
        onDataRef.current("\r\n\x1b[2m[reconnected]\x1b[0m\r\n");
      }
    };
    ws.onmessage = (e) => {
      try {
        const f = JSON.parse(e.data);
        if (f.t === "data" && typeof f.d === "string") onDataRef.current(f.d);
        else if (f.t === "exit") onDataRef.current(`\r\n[exit ${f.code}]\r\n`);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      readyRef.current = false;
      if (intentRef.current === "closed") return;
      // Auto-reconnect with bounded backoff.
      const attempt = attemptRef.current;
      if (attempt >= BACKOFF_SCHEDULE_MS.length) {
        setStatus("gave-up");
        return;
      }
      const delay = BACKOFF_SCHEDULE_MS[attempt];
      attemptRef.current = attempt + 1;
      setStatus("reconnecting");
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        connect();
      }, delay);
    };
    ws.onerror = () => {
      // onerror is informational — the subsequent onclose drives the
      // reconnect schedule. Don't double-handle.
    };
  }, [workId]);

  useEffect(() => {
    // Reset state for fresh workId mount.
    everConnectedRef.current = false;
    attemptRef.current = 0;
    queueRef.current = [];
    connect();
    return () => {
      intentRef.current = "closed";
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      readyRef.current = false;
    };
  }, [workId, connect]);

  const send = useCallback((data: string) => {
    const ws = wsRef.current;
    const frame = JSON.stringify({ t: "data", d: data });
    if (ws && readyRef.current) ws.send(frame);
    else queueRef.current.push(frame);
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws && readyRef.current) ws.send(JSON.stringify({ t: "resize", cols, rows }));
  }, []);

  const close = useCallback(() => {
    intentRef.current = "closed";
    wsRef.current?.close();
  }, []);

  const reconnect = useCallback(() => {
    // Manual reconnect — reset the backoff and try again immediately.
    attemptRef.current = 0;
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (wsRef.current) {
      // closeRef.current is null after close — guard for that.
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
    }
    connect();
  }, [connect]);

  return { send, resize, close, ready: readyRef.current, status, reconnect };
}

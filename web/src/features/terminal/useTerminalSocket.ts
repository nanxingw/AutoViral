import { useEffect, useRef, useCallback } from "react";

export interface TerminalSocket {
  send: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
  ready: boolean;
}

// Reads from window.location to build ws:// URL; lets dev + prod work
// without explicit config. Path matches src/server/terminal/terminal-ws.ts.
export function useTerminalSocket(
  workId: string,
  onData: (data: string) => void,
): TerminalSocket {
  const wsRef = useRef<WebSocket | null>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<string[]>([]);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const ws = new WebSocket(`${proto}://${host}/ws/terminal/${workId}`);
    wsRef.current = ws;
    ws.onopen = () => {
      readyRef.current = true;
      for (const q of queueRef.current) ws.send(q);
      queueRef.current = [];
    };
    ws.onmessage = (e) => {
      try {
        const f = JSON.parse(e.data);
        if (f.t === "data" && typeof f.d === "string") onData(f.d);
        else if (f.t === "exit") onData(`\r\n[exit ${f.code}]\r\n`);
      } catch { /* ignore */ }
    };
    ws.onclose = () => { readyRef.current = false; };
    return () => ws.close();
  }, [workId, onData]);

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

  const close = useCallback(() => wsRef.current?.close(), []);

  return { send, resize, close, ready: readyRef.current };
}

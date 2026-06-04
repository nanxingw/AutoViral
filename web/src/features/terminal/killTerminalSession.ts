/**
 * Dispose a terminal pty for (workId, sessionId) over a one-shot WS (I25).
 *
 * The terminal session strip owns the session LIST but not the live sockets —
 * each session's socket lives inside its mounted `TerminalPanel`. To honour an
 * explicit "delete this terminal" the strip must tell the server to dispose
 * that session's pty (ADR-008 §6: pty survives ws reconnect, so just closing a
 * socket is NOT enough — only an explicit `{"t":"kill"}` or shell exit disposes
 * it). Rather than plumb a kill callback up from every panel, the strip opens a
 * throwaway socket on the session's path, sends one `{"t":"kill"}` frame, and
 * closes — the server's terminal-ws handler disposes the pool entry on that
 * frame regardless of which socket sent it. The panel's own socket then gets an
 * `exit` frame; the strip removes the session from the store so the panel
 * unmounts.
 *
 * Best-effort + fire-and-forget: a missing WebSocket (SSR / private mode) or a
 * failed connect is swallowed — the store removal below still drops the tab.
 */
export function killTerminalSession(workId: string, sessionId: string): void {
  if (typeof WebSocket === "undefined") return;
  try {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const ws = new WebSocket(`${proto}://${host}/ws/terminal/${workId}/${sessionId}`);
    const killAndClose = () => {
      try {
        ws.send(JSON.stringify({ t: "kill" }));
      } catch {
        /* ignore */
      }
      // Give the frame a tick to flush before closing this throwaway socket.
      setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, 0);
    };
    // If the socket is already open (rare, synchronous mocks), send now;
    // otherwise wait for onopen.
    if (ws.readyState === ws.OPEN) killAndClose();
    else ws.onopen = killAndClose;
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  } catch {
    // ignore — connect threw; nothing we can do, store removal still proceeds
  }
}

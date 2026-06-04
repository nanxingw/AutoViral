import { WebSocketServer, type WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { PtyPool } from "./pty-pool.js";
import { dataDir } from "../../infra/config.js";
import { PACKAGE_ROOT } from "../../infra/paths.js";
import { join } from "node:path";
import { enforceLoopbackOrigin } from "../ws-origin.js";

// Wire format (JSON frames):
//   client → server: {"t":"data","d":"keystrokes"} | {"t":"resize","cols":80,"rows":24}
//                     | {"t":"kill"}  (explicit dispose — closes the shell)
//   server → client: {"t":"data","d":"chunk"} | {"t":"exit","code":0}
//
// The shell is picked from $SHELL, fallback /bin/zsh on macOS, /bin/bash
// elsewhere. AUTOVIRAL_WORK_ID + AUTOVIRAL_PORT are injected so the
// `autoviral` CLI on PATH auto-detects context.
//
// ADR-008 §6 — the pty is keyed by (workId, sessionId) and PERSISTS across ws
// reconnect: ws.close does NOT dispose it (a reload re-attaches to the same
// shell, scrollback intact). Multiple tabs on the same session multiplex onto
// one pty (output fanned to all; resize last-writer-wins). The pty is disposed
// only on an explicit {"t":"kill"} frame (session delete) or when the shell
// process exits.

/** The default/legacy terminal session id. A 2-segment legacy path
 *  (`/ws/terminal/{workId}`) resolves to this so nothing 500s mid-migration. */
const DEFAULT_TERMINAL_SESSION_ID = "s_1";

function pickShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  return process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
}

export interface TerminalWsHandle {
  close: () => void;
  handleUpgrade: (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => boolean;
}

/** Parse the path tail after `/ws/terminal/` into { workId, sessionId }.
 *  Accepts `{workId}` (legacy → default session) and `{workId}/{sessionId}`. */
function parseRoute(
  url: string,
  path: string,
): { workId: string; sessionId: string } | null {
  const tail = url.slice(path.length + 1).split("?")[0];
  if (!tail) return null;
  const [workId, sessionId] = tail.split("/");
  if (!workId) return null;
  return { workId, sessionId: sessionId && sessionId.trim() ? sessionId : DEFAULT_TERMINAL_SESSION_ID };
}

export function attachTerminalWebSocket(
  httpServer: HttpServer | null,
  port: number,
  path = "/ws/terminal",
): TerminalWsHandle {
  const wss = new WebSocketServer({ noServer: true });
  const pool = new PtyPool();

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    const url = req.url ?? "";
    if (!url.startsWith(path)) return false;
    // Phase 5 Task 5.5 — reject non-loopback origins as defense-in-depth.
    // Returning `true` here means "we handled this upgrade" — the socket
    // is already destroyed.
    if (!enforceLoopbackOrigin(req, socket, "terminal-ws")) return true;
    const route = parseRoute(url, path);
    if (!route) {
      socket.destroy();
      return true;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handle(ws, route.workId, route.sessionId);
    });
    return true;
  }

  if (httpServer) {
    httpServer.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });
  }

  function handle(ws: WebSocket, workId: string, sessionId: string): void {
    const cwd = join(dataDir, "works", workId);
    // Resume primitive — re-attach to the live pty for (workId, sessionId), or
    // spawn one if this is the first attach (or the previous shell exited).
    const session = pool.getOrSpawn({
      workId,
      sessionId,
      cwd,
      shell: pickShell(),
      cols: 80,
      rows: 24,
      env: {
        // Prepend the repo-contained `autoviral` shim dir so the command
        // resolves in the Studio terminal panel (pty-pool merges process.env,
        // so this prepends to the inherited PATH). Mirrors the chat-agent
        // wiring in ws-bridge.ts spawnCli. Anchors on PACKAGE_ROOT (not
        // process.cwd()) so it resolves inside a packaged Electron app.
        PATH: `${join(PACKAGE_ROOT, "cli", "autoviral", "bin")}:${process.env.PATH ?? ""}`,
        AUTOVIRAL_WORK_ID: workId,
        AUTOVIRAL_PORT: String(port),
        AUTOVIRAL_CWD: cwd,
      },
    });
    const send = (frame: unknown) =>
      ws.readyState === ws.OPEN && ws.send(JSON.stringify(frame));
    // Reconnect scrollback (ADR-008 §6) — getOrSpawn re-attached the SAME pty,
    // but a freshly-attached ws has missed all prior output. Replay the pty's
    // bounded buffer FIRST, then wire the live listener, so a reload shows prior
    // scrollback and live output continues from there (instead of a blank
    // terminal until the next keystroke).
    const backlog = pool.replayBuffer(workId, sessionId);
    if (backlog) send({ t: "data", d: backlog });
    // Per-attach listeners — output is fanned to every tab on this session;
    // detaching one tab leaves the others (and the pty) running.
    const offData = session.onData((d) => send({ t: "data", d }));
    const offExit = session.onExit((code) => {
      send({ t: "exit", code });
      try { ws.close(); } catch { /* ignore */ }
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.t === "data" && typeof msg.d === "string") session.write(msg.d);
        else if (msg.t === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
          // Last-writer-wins (ADR-008 §6) — same-session resize conflicts are
          // rare and not negotiated.
          session.resize(msg.cols, msg.rows);
        } else if (msg.t === "kill") {
          // Explicit session delete — dispose the pty (its onExit fans an
          // exit frame + the entry drops out of the pool).
          pool.dispose(workId, sessionId);
        }
      } catch {
        // ignore malformed frames
      }
    });
    ws.on("close", () => {
      // Detach THIS tab only. The pty survives reconnect (ADR-008 §6) — do NOT
      // dispose it here. It lives until an explicit {"t":"kill"} or shell exit.
      offData();
      offExit();
    });
  }

  return {
    close: () => {
      pool.disposeAll();
      wss.close();
    },
    handleUpgrade,
  };
}

import { WebSocketServer, type WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { PtyPool } from "./pty-pool.js";
import { dataDir } from "../../config.js";
import { PACKAGE_ROOT } from "../../paths.js";
import { join } from "node:path";
import { enforceLoopbackOrigin } from "../ws-origin.js";

// Wire format (JSON frames):
//   client → server: {"t":"data","d":"keystrokes"} | {"t":"resize","cols":80,"rows":24}
//   server → client: {"t":"data","d":"chunk"} | {"t":"exit","code":0}
//
// The shell is picked from $SHELL, fallback /bin/zsh on macOS, /bin/bash
// elsewhere. AUTOVIRAL_WORK_ID + AUTOVIRAL_PORT are injected so the
// `autoviral` CLI on PATH auto-detects context.

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
    const workId = url.slice(path.length + 1).split("?")[0];
    if (!workId) {
      socket.destroy();
      return true;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handle(ws, workId);
    });
    return true;
  }

  if (httpServer) {
    httpServer.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });
  }

  function handle(ws: WebSocket, workId: string): void {
    const cwd = join(dataDir, "works", workId);
    const session = pool.spawn({
      workId,
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
          session.resize(msg.cols, msg.rows);
        }
      } catch {
        // ignore malformed frames
      }
    });
    ws.on("close", () => {
      offData();
      offExit();
      pool.dispose(session.id);
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

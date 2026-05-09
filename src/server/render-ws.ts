// src/server/render-ws.ts
//
// Phase 7.B Step 2 — WebSocket router for /ws/render/jobs/:id.
//
// Pattern mirrors WsBridge: a `noServer: true` WebSocketServer that the
// owning HTTP server feeds via handleUpgrade(). The router owns its lifetime
// and emits forwarded progress events as JSON frames. On terminal status
// (done/failed/cancelled) the server closes the socket — D5/D10 say the
// client never auto-reconnects, terminal closes the stream.

import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type {
  RenderQueue,
  WorkerProgressEvent,
} from "./render-queue/index.js";
import { isTerminalStatus } from "./render-queue/job.js";

const URL_RE = /^\/ws\/render\/jobs\/([^/?]+)/;

export class RenderWsRouter {
  private wss: WebSocketServer;

  constructor(private readonly queue: RenderQueue) {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on(
      "connection",
      (ws: WebSocket, _req: IncomingMessage, jobId: string) => {
        this.handleConnection(ws, jobId);
      },
    );
  }

  private handleConnection(ws: WebSocket, jobId: string): void {
    const cur = this.queue.get(jobId);
    if (!cur) {
      // Job doesn't exist (e.g. old jobId after a restart). Send a synthetic
      // failed frame and close so the client doesn't sit waiting forever.
      try {
        ws.send(
          JSON.stringify({
            at: new Date().toISOString(),
            status: "failed",
            progress: 0,
            log: {
              at: new Date().toISOString(),
              level: "error",
              msg: "job not found",
            },
          }),
        );
      } catch {
        /* socket already gone */
      }
      try {
        ws.close(1011, "job not found");
      } catch {
        /* ignore */
      }
      return;
    }

    // First frame is a snapshot of the current row so the client can render
    // immediately even if no progress event has fired since enqueue.
    // R43 — include outputPath + error so reconnecting to an already-
    // terminal job restores the full UI state (otherwise reconnect lands
    // on "done" without knowing where the file is, and the user sees no
    // affordance to open it).
    try {
      ws.send(
        JSON.stringify({
          at: new Date().toISOString(),
          status: cur.status,
          progress: cur.progress,
          stage: cur.stage,
          outputPath: cur.outputPath,
          error: cur.error,
        }),
      );
    } catch {
      return;
    }

    // If the job is already in a terminal state when the client connects,
    // close right after the snapshot — there will be no further events.
    if (isTerminalStatus(cur.status)) {
      try {
        ws.close(1000, "terminal");
      } catch {
        /* ignore */
      }
      return;
    }

    const off = this.queue.on(jobId, (ev: WorkerProgressEvent) => {
      try {
        ws.send(JSON.stringify(ev));
      } catch {
        /* socket may be closed mid-send */
      }
      if (isTerminalStatus(ev.status)) {
        off();
        try {
          ws.close(1000, "terminal");
        } catch {
          /* ignore */
        }
      }
    });
    ws.on("close", off);
  }

  /**
   * Handle an HTTP upgrade. Returns true if this router accepted the request
   * (meaning the upgrade is now ours and the caller should NOT fall through
   * to other handlers). Returns false for any non-matching URL — the caller
   * is responsible for the next handler / socket destroy.
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = req.url ?? "";
    const m = url.match(URL_RE);
    if (!m) return false;
    const jobId = m[1]!;
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit("connection", ws, req, jobId);
    });
    return true;
  }

  close(): void {
    this.wss.close();
  }
}

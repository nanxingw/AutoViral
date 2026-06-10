// /ws/bridge/:workId — bidirectional WebSocket between Studio UI and the
// AutoViral bridge. Outbound: subscribes to UiEventBus and forwards every
// event as a JSON frame. Inbound: parses `approval-response` frames from
// the Studio's ApprovalPrompt (Task 3.9).
//
// We follow the same `handleUpgrade` shape as terminal-ws so the central
// upgrade dispatcher in `server/index.ts` can multiplex both adapters.

import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { uiEventBus, type UiEvent } from "./ui-events.js";
import { answerAsk } from "./approval-gate.js";
import { watchCompositionFor } from "./composition-watcher.js";
import { watchPlanFor } from "./plan-watcher.js";
import { watchAssetsFor } from "./assets-watcher.js";
import { enforceLoopbackOrigin } from "../ws-origin.js";

export interface BridgeWsHandle {
  close: () => void;
  handleUpgrade: (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => boolean;
}

export function attachBridgeWebSocket(
  httpServer: HttpServer | null,
  path = "/ws/bridge",
): BridgeWsHandle {
  const wss = new WebSocketServer({ noServer: true });

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
    if (!enforceLoopbackOrigin(req, socket, "bridge-ws")) return true;
    const workId = url.slice(path.length + 1).split("?")[0];
    if (!workId) {
      socket.destroy();
      return true;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handle(ws, workId));
    return true;
  }

  if (httpServer) {
    httpServer.on("upgrade", (req, socket, head) => {
      handleUpgrade(req, socket, head);
    });
  }

  function handle(ws: WebSocket, workId: string): void {
    // Outbound: every UiEventBus emit for this workId becomes a frame.
    const off = uiEventBus.subscribe(workId, (event: UiEvent) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    });

    // Phase 3 Task 3.10 — kick off the composition file watcher (idempotent
    // per workId). External `composition.yaml` edits → composition-changed
    // events → Studio re-fetches via useBridgeEvents.
    try {
      watchCompositionFor(workId);
    } catch {
      /* watcher unavailable — events still flow over WS for in-app writes */
    }

    // S5 (PRD-0007) — twin watcher for the planning-layer 剧本 (plan/script.md).
    // External edits (agent via `autoviral script edit`, a text editor) →
    // plan-changed events → Studio refetches the script via useBridgeEvents.
    try {
      watchPlanFor(workId);
    } catch {
      /* watcher unavailable — in-app PUT still broadcasts plan-changed directly */
    }

    // Assets-library watcher — ANY file landing in assets/ (agent writing via
    // Bash/ffmpeg/python, transition/captions/mix outputs, scene generate)
    // → asset-added → Studio library refetches live. The blessed generation
    // endpoints still publish their own asset-added; the watcher is the
    // chokepoint that covers everyone else.
    try {
      watchAssetsFor(workId);
    } catch {
      /* watcher unavailable — endpoint-published asset-added still flows */
    }

    // Inbound: Studio replies to ui-ask events with approval-response frames
    // ({ t: "approval-response", askId, answer }). We route them into the
    // approval-gate so the corresponding /ask HTTP request unblocks.
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          t?: string;
          askId?: string;
          answer?: "yes" | "no" | "cancelled";
        };
        if (
          msg.t === "approval-response" &&
          typeof msg.askId === "string" &&
          (msg.answer === "yes" || msg.answer === "no" || msg.answer === "cancelled")
        ) {
          answerAsk(msg.askId, msg.answer);
        }
      } catch {
        /* ignore malformed frames */
      }
    });

    ws.on("close", () => off());
    ws.on("error", () => off());
  }

  return { close: () => wss.close(), handleUpgrade };
}

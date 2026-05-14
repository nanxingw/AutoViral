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

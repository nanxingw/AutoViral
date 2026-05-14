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

    // Inbound: parsed in Task 3.9 (approval gate) and Task 3.10
    // (composition watcher). For Task 3.2 we just accept the connection.
    ws.on("message", () => {
      /* Phase 3 Task 3.9 wires approval-response handling here */
    });

    ws.on("close", () => off());
    ws.on("error", () => off());
  }

  return { close: () => wss.close(), handleUpgrade };
}

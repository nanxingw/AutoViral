// Phase 5 Task 5.5 — integration check that bridge-ws + terminal-ws
// both refuse upgrade for foreign Origin headers.
//
// We exercise the `handleUpgrade` entry point directly with a fake
// IncomingMessage + Duplex socket; that's enough to verify the origin
// check fires BEFORE the actual `ws` handshake runs.

import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { attachBridgeWebSocket } from "../bridge-ws.js";
import { attachTerminalWebSocket } from "../../terminal/terminal-ws.js";

function makeReq(origin: string | undefined, path: string): IncomingMessage {
  return {
    url: path,
    headers: origin !== undefined ? { origin } : {},
  } as unknown as IncomingMessage;
}

function makeSocket(): { socket: Duplex; destroyed: () => boolean } {
  const state = { destroyed: false };
  const socket = {
    destroy: () => {
      state.destroyed = true;
    },
    on: () => {},
    write: () => true,
    end: () => {},
  } as unknown as Duplex;
  return { socket, destroyed: () => state.destroyed };
}

describe("bridge-ws origin gate", () => {
  it("destroys the socket when Origin is non-loopback", () => {
    const handle = attachBridgeWebSocket(null);
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const { socket, destroyed } = makeSocket();
    const req = makeReq("http://evil.com", "/ws/bridge/w_x");
    const handled = handle.handleUpgrade(req, socket, Buffer.alloc(0));
    expect(handled).toBe(true);
    expect(destroyed()).toBe(true);
    writeSpy.mockRestore();
    handle.close();
  });

  it("does NOT destroy when Origin is localhost", () => {
    const handle = attachBridgeWebSocket(null);
    const { socket, destroyed } = makeSocket();
    const req = makeReq("http://localhost:5173", "/ws/bridge/w_x");
    // We pass a real-shaped req; handleUpgrade will call wss.handleUpgrade
    // which expects a real socket — that part will fail/no-op for our fake.
    // The origin check itself runs FIRST and is what we're verifying.
    try {
      handle.handleUpgrade(req, socket, Buffer.alloc(0));
    } catch {
      /* expected — fake socket can't complete the ws handshake */
    }
    expect(destroyed()).toBe(false);
    handle.close();
  });
});

describe("terminal-ws origin gate", () => {
  it("destroys the socket when Origin is non-loopback", () => {
    const handle = attachTerminalWebSocket(null, 4567);
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const { socket, destroyed } = makeSocket();
    const req = makeReq("http://evil.com", "/ws/terminal/w_x");
    const handled = handle.handleUpgrade(req, socket, Buffer.alloc(0));
    expect(handled).toBe(true);
    expect(destroyed()).toBe(true);
    const logged = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(logged).toContain("terminal-ws");
    writeSpy.mockRestore();
    handle.close();
  });
});

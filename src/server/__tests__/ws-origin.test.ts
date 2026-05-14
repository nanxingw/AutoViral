// Phase 5 Task 5.5 — unit tests for the WebSocket origin gate.

import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { isOriginAllowed, enforceLoopbackOrigin } from "../ws-origin.js";

function req(origin?: string, url = "/ws/bridge/w_test"): IncomingMessage {
  return {
    url,
    headers: origin !== undefined ? { origin } : {},
  } as unknown as IncomingMessage;
}

function fakeSocket(): { socket: Duplex; destroyed: boolean } {
  const state = { destroyed: false } as { destroyed: boolean };
  const socket = {
    destroy: () => {
      state.destroyed = true;
    },
  } as unknown as Duplex;
  return { socket, destroyed: state as any as boolean, ...state };
}

describe("isOriginAllowed", () => {
  it("allows missing Origin (native CLI / non-browser client)", () => {
    expect(isOriginAllowed(req(undefined))).toBe(true);
  });

  it("allows empty-string Origin", () => {
    expect(isOriginAllowed(req(""))).toBe(true);
  });

  it("allows http://localhost (any port)", () => {
    expect(isOriginAllowed(req("http://localhost:5173"))).toBe(true);
    expect(isOriginAllowed(req("http://localhost"))).toBe(true);
  });

  it("allows http://127.0.0.1 (any port)", () => {
    expect(isOriginAllowed(req("http://127.0.0.1:4567"))).toBe(true);
  });

  it("allows http://[::1] (IPv6 loopback, any port)", () => {
    expect(isOriginAllowed(req("http://[::1]:5173"))).toBe(true);
  });

  it("rejects http://evil.com", () => {
    expect(isOriginAllowed(req("http://evil.com"))).toBe(false);
  });

  it("rejects malformed Origin", () => {
    expect(isOriginAllowed(req("not-a-url"))).toBe(false);
  });

  it("rejects http://localhost.evil.com (subdomain trick)", () => {
    expect(isOriginAllowed(req("http://localhost.evil.com"))).toBe(false);
  });
});

describe("enforceLoopbackOrigin", () => {
  it("returns true and leaves socket open for loopback origin", () => {
    let destroyed = false;
    const socket = { destroy: () => (destroyed = true) } as unknown as Duplex;
    const ok = enforceLoopbackOrigin(
      req("http://localhost:5173"),
      socket,
      "test",
    );
    expect(ok).toBe(true);
    expect(destroyed).toBe(false);
  });

  it("destroys socket + returns false for non-loopback origin", () => {
    let destroyed = false;
    const socket = { destroy: () => (destroyed = true) } as unknown as Duplex;
    const ok = enforceLoopbackOrigin(req("http://evil.com"), socket, "test");
    expect(ok).toBe(false);
    expect(destroyed).toBe(true);
  });

  it("logs the rejected origin + path to stderr", () => {
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const socket = { destroy: () => {} } as unknown as Duplex;
    enforceLoopbackOrigin(
      req("http://attacker.example", "/ws/terminal/w_x"),
      socket,
      "terminal-ws",
    );
    expect(writeSpy).toHaveBeenCalled();
    const logged = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(logged).toContain("http://attacker.example");
    expect(logged).toContain("/ws/terminal/w_x");
    expect(logged).toContain("terminal-ws");
    writeSpy.mockRestore();
  });
});

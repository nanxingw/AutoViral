// Phase 5 Task 5.5 — defense-in-depth: only accept WebSocket upgrades
// when the `Origin` header (if present) resolves to a loopback address.
//
// The HTTP server binds to 127.0.0.1 by default so this is mostly belt-
// and-suspenders, but a misconfigured deployment or local proxy could
// expose the bridge to a non-loopback interface. Native CLIs (curl, raw
// `ws` client, the `autoviral` CLI's WebSocket-less HTTP calls) do NOT
// send an Origin header at all — we treat absence as benign.
//
// Anything WITH an Origin that doesn't resolve to localhost/127.0.0.1/
// ::1 (or their explicit-port variants like http://localhost:5173) is
// rejected with a `socket.destroy()` so no upgrade handshake completes.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Returns true if the upgrade request's Origin header should be allowed
 * (loopback / missing). Returns false to indicate the upgrade must be
 * rejected. Caller is responsible for `socket.destroy()` + logging.
 */
export function isOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.length === 0) {
    // No Origin: most likely a native CLI / Node WebSocket client.
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    // Malformed Origin header — reject defensively. A well-formed
    // browser will never produce this.
    return false;
  }
  return LOCAL_HOSTNAMES.has(parsed.hostname);
}

/**
 * Convenience wrapper: enforce the origin policy and tear down the
 * socket if it fails. Returns true when the request passed the check
 * (caller proceeds with the upgrade); false when the socket was
 * destroyed (caller should abort).
 */
export function enforceLoopbackOrigin(
  req: IncomingMessage,
  socket: Duplex,
  context: string,
): boolean {
  if (isOriginAllowed(req)) return true;
  const origin = req.headers.origin ?? "<missing>";
  const path = req.url ?? "<unknown>";
  // Stderr — visible in dev console + production logs.
  process.stderr.write(
    `[ws] rejected cross-origin upgrade: origin=${origin} path=${path} context=${context}\n`,
  );
  try {
    socket.destroy();
  } catch {
    /* ignore */
  }
  return false;
}

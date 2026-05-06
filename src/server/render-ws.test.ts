// src/server/render-ws.test.ts
//
// Phase 7.B Step 2: tests for the /ws/render/jobs/:id WebSocket router.
//
// We spin up a real http.Server on an ephemeral port, route upgrades through
// RenderWsRouter, and connect with the `ws` client. The queue is mocked with
// a FakeQueue that lets us emit progress events on demand.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import WebSocket, { WebSocketServer as _WSS } from "ws";
import { EventEmitter } from "node:events";
import { RenderWsRouter } from "./render-ws.js";
import type { WorkerProgressEvent } from "./render-queue/index.js";

// Silence unused import warning — only here to keep the dep visible.
void _WSS;

/**
 * Minimal FakeQueue — only the methods RenderWsRouter touches:
 *   - get(id)             → returns the current row (or null)
 *   - on(id, fn) → off    → subscribe to progress events
 * Plus a test-only emitFor(id, ev) to fire events from the test body.
 */
class FakeQueue extends EventEmitter {
  rows = new Map<string, any>();
  add(id: string, row: any): void {
    this.rows.set(id, row);
  }
  get(id: string): any {
    return this.rows.get(id) ?? null;
  }
  on(jobId: string | symbol, fn: any): any {
    // EventEmitter.on overload with two-arg form returning `this` is what
    // node expects internally. RenderQueue.on returns an unsubscribe fn —
    // we mirror that contract for the second-arg-is-function shape but only
    // when the first arg is a string job id (not a numeric/symbol event).
    if (typeof jobId === "string" && jobId.startsWith("job_")) {
      const k = `j:${jobId}`;
      super.on(k, fn);
      return () => super.off(k, fn);
    }
    return super.on(jobId as any, fn);
  }
  emitFor(jobId: string, ev: WorkerProgressEvent): void {
    super.emit(`j:${jobId}`, ev);
  }
}

let server: Server;
let port: number;
let queue: FakeQueue;
let router: RenderWsRouter;
let openClients: WebSocket[];

beforeEach(async () => {
  queue = new FakeQueue();
  router = new RenderWsRouter(queue as any);
  openClients = [];
  server = createServer();
  server.on("upgrade", (req, sock, head) => {
    if (!router.handleUpgrade(req, sock, head)) sock.destroy();
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  port = (server.address() as any).port;
});

afterEach(async () => {
  // Force-terminate any open client sockets (server-side closes follow).
  for (const ws of openClients) {
    try {
      ws.terminate();
    } catch {
      /* ignore */
    }
  }
  router.close();
  // Force-close any lingering keep-alive sockets so server.close() resolves.
  if (typeof (server as any).closeAllConnections === "function") {
    (server as any).closeAllConnections();
  }
  await new Promise<void>((res) => server.close(() => res()));
});

function connect(jobId: string): Promise<WebSocket> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/render/jobs/${jobId}`);
    openClients.push(ws);
    ws.once("open", () => res(ws));
    ws.once("error", rej);
  });
}

/**
 * Read messages from a ws as JSON until we have `n`. Resolves with the array.
 */
function collectMessages(ws: WebSocket, n: number): Promise<any[]> {
  return new Promise((res) => {
    const out: any[] = [];
    ws.on("message", (b) => {
      out.push(JSON.parse(b.toString()));
      if (out.length >= n) res(out);
    });
  });
}

describe("/ws/render/jobs/:id", () => {
  it("forwards progress events to subscribers", async () => {
    queue.add("job_1", {
      id: "job_1",
      status: "queued",
      progress: 0,
      log: [],
    });
    const messages: any[] = [];
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws/render/jobs/job_1`,
    );
    openClients.push(ws);
    ws.on("message", (b) => messages.push(JSON.parse(b.toString())));
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });
    // Give the server a microtask tick to flush the snapshot frame.
    await new Promise((r) => setTimeout(r, 20));
    queue.emitFor("job_1", {
      at: "t",
      status: "running",
      progress: 0.4,
      stage: "render",
    });
    // Wait until both frames arrive.
    const deadline = Date.now() + 2000;
    while (messages.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0]).toMatchObject({ status: "queued", progress: 0 });
    expect(messages[1]).toMatchObject({
      status: "running",
      progress: 0.4,
      stage: "render",
    });
  });

  it("closes the socket after a terminal event (D5)", async () => {
    queue.add("job_2", {
      id: "job_2",
      status: "queued",
      progress: 0,
      log: [],
    });
    const ws = await connect("job_2");
    const closed = new Promise<number>((res) =>
      ws.on("close", (code) => res(code)),
    );
    queue.emitFor("job_2", { at: "t", status: "done", progress: 1 });
    const code = await closed;
    expect(code).toBeGreaterThanOrEqual(1000);
    expect(code).toBeLessThan(5000);
  });

  it("rejects upgrade for unknown URL paths", () => {
    const dummyReq: any = { url: "/ws/other/123" };
    let destroyed = false;
    const dummySock: any = {
      destroy: () => {
        destroyed = true;
      },
    };
    expect(
      router.handleUpgrade(dummyReq, dummySock, Buffer.alloc(0)),
    ).toBe(false);
    // The router doesn't destroy on a non-match — it just declines so the
    // outer chain can fall through to the next handler.
    expect(destroyed).toBe(false);
  });
});

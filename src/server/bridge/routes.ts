// AutoViral Bridge router — mounts at /api/bridge/v1.
// Phase 0: whoami only (smoke test of the wire). Phase 2-3 expand to
// read-only (comp/list/docs) + writes (clip add/set/remove) + UI commands
// (select/seek/play/pause/toast/progress) + approval gate (ask) + tasks
// (export/render). See docs/superpowers/specs/2026-05-14-agentic-terminal-
// bridge-protocol.md for the full surface.

import { Hono } from "hono";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WhoAmIResponse } from "./schemas.js";

export const bridgeRouter = new Hono();

const BRIDGE_VERSION = "0.1.0";

function workIdOrError(c: Parameters<Parameters<Hono["get"]>[1]>[0]):
  | { ok: true; workId: string }
  | { ok: false; res: Response } {
  const workId = c.req.header("X-AutoViral-Work-Id");
  if (!workId) {
    return {
      ok: false,
      res: c.json({ ok: false, error: "missing X-AutoViral-Work-Id header", code: 4 }, 400),
    };
  }
  return { ok: true, workId };
}

bridgeRouter.get("/whoami", (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const port = Number(process.env.AUTOVIRAL_PORT ?? 3271);
  const body: WhoAmIResponse = {
    workId: g.workId,
    cwd: join(homedir(), ".autoviral/works", g.workId),
    port,
    version: BRIDGE_VERSION,
  };
  return c.json({ ok: true, result: body });
});

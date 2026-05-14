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
import { readCompositionFor } from "./composition-ops.js";

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

// Phase 2 — read-only composition routes. All three (/comp, /clips, /assets)
// load the same composition.yaml via composition-ops; we deliberately do NOT
// keep a cache because the fixture/dev workflow re-reads on every command
// and an agent that just wrote (Phase 3) must see fresh state immediately.

bridgeRouter.get("/comp", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  try {
    const comp = await readCompositionFor({ workId: g.workId });
    return c.json({ ok: true, result: comp });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

// /clips and /assets are convenience projections of /comp. We keep them
// separate (rather than telling agents to "fetch /comp and filter in jq")
// because the JSON envelope itself is large, and a list-of-summaries is
// the natural shape an agent renders to a TUI table.

bridgeRouter.get("/clips", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const trackFilter = c.req.query("track");
  try {
    const comp = await readCompositionFor({ workId: g.workId });
    const clips = comp.tracks
      .filter((t) => !trackFilter || t.kind === trackFilter)
      .flatMap((t) =>
        t.clips.map((clip) => ({
          id: clip.id,
          kind: clip.kind,
          trackId: t.id,
          trackKind: t.kind,
          trackOffset: clip.trackOffset,
          duration:
            "out" in clip
              ? clip.out - clip.in
              : (clip as { duration: number }).duration,
        })),
      );
    return c.json({ ok: true, result: clips });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

bridgeRouter.get("/assets", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const kindFilter = c.req.query("kind");
  try {
    const comp = await readCompositionFor({ workId: g.workId });
    const assets = comp.assets.filter((a) => !kindFilter || a.kind === kindFilter);
    return c.json({ ok: true, result: assets });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

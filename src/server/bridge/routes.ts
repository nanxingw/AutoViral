// AutoViral Bridge router — mounts at /api/bridge/v1.
// Phase 0: whoami only (smoke test of the wire). Phase 2-3 expand to
// read-only (comp/list/docs) + writes (clip add/set/remove) + UI commands
// (select/seek/play/pause/toast/progress) + approval gate (ask) + tasks
// (export/render). See docs/superpowers/specs/2026-05-14-agentic-terminal-
// bridge-protocol.md for the full surface.

import { Hono, type Context } from "hono";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type { WhoAmIResponse } from "./schemas.js";
import {
  SelectRequestSchema,
  SeekRequestSchema,
  ToastRequestSchema,
  ProgressRequestSchema,
  AskRequestSchema,
} from "./schemas.js";
import { createAsk } from "./approval-gate.js";
import { readCompositionFor, mutateCompositionFor } from "./composition-ops.js";
import { uiEventBus } from "./ui-events.js";
import { randomBytes } from "node:crypto";

function manualDir(): string {
  return process.env.AUTOVIRAL_MANUAL_DIR ?? join(process.cwd(), "skills/autoviral/manual");
}

export const bridgeRouter = new Hono();

const BRIDGE_VERSION = "0.1.0";

function workIdOrError(c: Context):
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

// Docs return raw markdown, NOT JSON-wrapped — `autoviral docs` pipes the
// body straight to stdout for the agent to read. Topic omitted → all
// manual files concatenated with thematic-break separators, sorted by
// filename so 00-overview / 10-... ordering is the author's lever.
// ─── Phase 3 — UI command routes ────────────────────────────────────────────
// Each route validates the body with zod, then publishes a "ui-*" event on
// UiEventBus. The /ws/bridge/:workId WebSocket forwards events to Studio.
// HTTP returns ok immediately — the round-trip is fire-and-forget; the
// agent does not block waiting for the UI to render. (The `/ask` route in
// Task 3.9 is the exception; it blocks until the user replies.)

function broadcast(workId: string, type: string, payload: unknown): void {
  uiEventBus.publish(workId, { type, workId, ts: Date.now(), payload });
}

bridgeRouter.post("/select", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = SelectRequestSchema.parse(await c.req.json());
  broadcast(g.workId, "ui-select", body.target);
  return c.json({ ok: true, result: { selected: body.target } });
});

bridgeRouter.post("/seek", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = SeekRequestSchema.parse(await c.req.json());
  broadcast(g.workId, "ui-seek", { seconds: body.seconds });
  return c.json({ ok: true, result: { seekedTo: body.seconds } });
});

bridgeRouter.post("/play", (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  broadcast(g.workId, "ui-play", null);
  return c.json({ ok: true });
});

bridgeRouter.post("/pause", (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  broadcast(g.workId, "ui-pause", null);
  return c.json({ ok: true });
});

bridgeRouter.post("/toast", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = ToastRequestSchema.parse(await c.req.json());
  broadcast(g.workId, "ui-toast", body);
  return c.json({ ok: true });
});

bridgeRouter.post("/progress", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = ProgressRequestSchema.parse(await c.req.json());
  broadcast(g.workId, "ui-progress", body);
  return c.json({ ok: true });
});

// ─── Phase 3 — composition write endpoints ──────────────────────────────────
// All three (POST /clip, PATCH /clip/:id, DELETE /clip/:id) go through
// mutateCompositionFor which read-modifies-writes atomically + validates
// via zod. Disk state is left untouched on validation failure. The Phase 3
// surface is intentionally minimal — agents that need richer mutations
// (split clips, reframe, smart-crop) compose them client-side and POST
// the resulting full composition; we add convenience verbs only for the
// few mutations that recur often enough to justify the round-trip.

function newClipId(track: "video" | "audio" | "overlay" | "text"): string {
  const prefix =
    track === "video" ? "vc"
      : track === "audio" ? "ac"
      : track === "text" ? "tc"
      : "oc";
  return `${prefix}_${randomBytes(3).toString("hex")}`;
}

bridgeRouter.post("/clip", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = (await c.req.json()) as {
    src?: string;
    text?: string;
    track: "video" | "audio" | "overlay" | "text";
    offset?: number;
    duration?: number;
    in?: number;
    out?: number;
  };
  if (!body.track) return c.json({ ok: false, error: "missing track" }, 400);
  let newId = "";
  try {
    await mutateCompositionFor({ workId: g.workId }, (comp) => {
      const track = comp.tracks.find((t) => t.kind === body.track);
      if (!track) throw new Error(`No track of kind ${body.track}`);
      const id = newClipId(body.track);
      newId = id;
      const offset = body.offset ?? 0;
      if (body.track === "video") {
        if (!body.src) throw new Error("video clip requires --src");
        track.clips.push({
          id,
          kind: "video",
          src: body.src,
          in: body.in ?? 0,
          out: body.out ?? (body.duration ?? 5),
          trackOffset: offset,
          transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
          filters: { brightness: 0, contrast: 0, saturation: 0 },
        } as any);
      } else if (body.track === "audio") {
        if (!body.src) throw new Error("audio clip requires --src");
        track.clips.push({
          id,
          kind: "audio",
          src: body.src,
          in: body.in ?? 0,
          out: body.out ?? (body.duration ?? 5),
          trackOffset: offset,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
        } as any);
      } else if (body.track === "text") {
        if (!body.text) throw new Error("text clip requires --text");
        track.clips.push({
          id,
          kind: "text",
          text: body.text,
          trackOffset: offset,
          duration: body.duration ?? 3,
        } as any);
      } else {
        throw new Error(`overlay track not yet supported in Phase 3`);
      }
      return comp;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 400);
  }
  return c.json({ ok: true, result: { id: newId } });
});

bridgeRouter.delete("/clip/:id", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const id = c.req.param("id");
  try {
    await mutateCompositionFor({ workId: g.workId }, (comp) => ({
      ...comp,
      tracks: comp.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((cl: any) => cl.id !== id),
      })),
    }) as any);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 400);
  }
  return c.json({ ok: true });
});

// POST /ask blocks the HTTP response until the Studio user clicks
// YES/NO in the ApprovalPrompt modal — or until timeoutMs elapses.
// CLI exit codes (per protocol §5): yes=0, no=1, cancelled=2, timeout=124.
bridgeRouter.post("/ask", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = AskRequestSchema.parse(await c.req.json());
  const { askId, promise } = createAsk(g.workId, body.timeoutMs);
  broadcast(g.workId, "ui-ask", {
    askId,
    message: body.message,
    kind: body.kind,
  });
  const answer = await promise;
  if (answer === "timeout") {
    return c.json({ ok: false, error: "timeout", code: 124 }, 504);
  }
  return c.json({ ok: true, result: { answer } });
});

bridgeRouter.patch("/clip/:id", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const id = c.req.param("id");
  const patch = (await c.req.json()) as Record<string, unknown>;
  try {
    await mutateCompositionFor({ workId: g.workId }, (comp) => ({
      ...comp,
      tracks: comp.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((cl: any) =>
          cl.id === id ? { ...cl, ...patch } : cl,
        ),
      })),
    }) as any);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 400);
  }
  return c.json({ ok: true });
});

bridgeRouter.get("/docs", async (c) => {
  const topic = c.req.query("topic");
  const dir = manualDir();
  try {
    if (topic) {
      const file = join(dir, topic.endsWith(".md") ? topic : `${topic}.md`);
      const md = await readFile(file, "utf8");
      return c.text(md);
    }
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
    const chunks = await Promise.all(files.map((f) => readFile(join(dir, f), "utf8")));
    return c.text(chunks.join("\n\n---\n\n"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 404);
  }
});

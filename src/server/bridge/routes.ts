// AutoViral Bridge router — mounts at /api/bridge/v1.
// Phase 0: whoami only (smoke test of the wire). Phase 2-3 expand to
// read-only (comp/list/docs) + writes (clip add/set/remove) + UI commands
// (select/seek/play/pause/toast/progress) + approval gate (ask) + tasks
// (export/render). See docs/archive/specs/2026-05-14-agentic-terminal-
// bridge-protocol.md for the full surface.

import { Hono, type Context } from "hono";
import { homedir } from "node:os";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../../paths.js";
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
import {
  readCompositionFor,
  mutateCompositionFor,
  diffCompositionFor,
} from "./composition-ops.js";
import { uiEventBus } from "./ui-events.js";
import { randomBytes } from "node:crypto";
import { runRenderPipeline, type RenderStage } from "../render-pipeline.js";
import { ingestYouTubeIntoWork } from "./ingest-youtube.js";
import {
  read as readFocus,
  write as writeFocus,
  subscribe as subscribeFocus,
} from "../../focus/index.js";
import { resolve as resolveVariables } from "../../composition/variables/index.js";
import {
  synthesize as synthesizeTts,
  TTS_VOICES,
  TTS_FORMATS,
} from "../../providers/tts/index.js";
import { getContext, getProfile, getTrends } from "../../context/index.js";
import { lintComposition } from "../../composition/quality/lint.js";
import { inspectComposition } from "../../composition/quality/inspect.js";
import { validateComposition } from "../../composition/quality/validate.js";
import { animationMap } from "../../composition/quality/animation-map.js";
import { createHash } from "node:crypto";
import { z } from "zod";

// Per-workId boolean flag controlling whether the terminal prefix line
// renders. Stored in-memory; frontend mirrors to localStorage for cross-
// reload persistence. CLI flips it via `autoviral context --inject on|off`.
const terminalInjectEnabled = new Map<string, boolean>();
function readInject(workId: string): boolean {
  return terminalInjectEnabled.get(workId) ?? true;
}
function writeInject(workId: string, enabled: boolean): void {
  terminalInjectEnabled.set(workId, enabled);
}

function manualDir(): string {
  // Anchor on PACKAGE_ROOT (not process.cwd()) so `autoviral docs` resolves the
  // bundled manual inside a packaged Electron app; AUTOVIRAL_MANUAL_DIR still wins.
  return process.env.AUTOVIRAL_MANUAL_DIR ?? join(PACKAGE_ROOT, "skills/autoviral/manual");
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

// Phase 5 Task 5.4 — unified diff between composition.yaml.previous (the
// snapshot taken just before the most recent write) and the current
// composition.yaml. Returns `{ diff: string, hasBaseline: boolean }`.
// When no baseline exists yet, `hasBaseline=false` and `diff=""` — the
// CLI prints a friendly "no prior write to diff against" message.
bridgeRouter.get("/comp/diff", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  try {
    const result = await diffCompositionFor({ workId: g.workId });
    return c.json({ ok: true, result });
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

// ─── H0.1 — Focus channel ───────────────────────────────────────────────────
// The frontend SSoT pushes UI-selection state here whenever the user clicks
// a clip / scrubs the playhead / focuses a panel. Both the chat panel (via
// <viewer-context> envelope) and the terminal panel (via dim [ctx:...] prefix)
// consume the same snapshot — chat reads it on outbound messages, terminal
// renders it as a prefix line. The `ui-focus` event lets any third-party
// surface subscribe via WS.
//
// H0.2 expanded the schema to include playhead, segment, and panel focus.
// All fields are optional in the patch so callers can update just what
// changed (no need to round-trip the full snapshot).
const ActivePanelSchema = z.enum([
  "timeline",
  "inspector",
  "preview",
  "sidebar",
]);
const FocusPatchSchema = z.object({
  selectedClipId: z.string().nullable().optional(),
  playheadSec: z.number().min(0).optional(),
  selectedSegmentId: z.string().nullable().optional(),
  activePanel: ActivePanelSchema.nullable().optional(),
});

bridgeRouter.get("/focus", (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  return c.json({ ok: true, result: readFocus(g.workId) });
});

bridgeRouter.post("/focus", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = FocusPatchSchema.parse(await c.req.json());
  const next = writeFocus(g.workId, body);
  broadcast(g.workId, "ui-focus", next);
  return c.json({ ok: true, result: next });
});

// ─── H0.3 — Context aggregator + SSE stream + inject toggle ─────────────────

bridgeRouter.get("/context", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const q = c.req.query();
  const ctx = await getContext(g.workId, {
    includeProfile: q.profile !== "false",
    includeTrends: q.trends === "true",
  });
  return c.json({
    ok: true,
    result: { ...ctx, terminalInjectEnabled: readInject(g.workId) },
  });
});

// H0.4 — dedicated endpoints (lighter than the full /context call)
bridgeRouter.get("/profile", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const profile = await getProfile();
  return c.json({ ok: true, result: profile });
});

// ─── H1.1-H1.4 — quality gate (static analysis; Puppeteer follow-up tbd) ────
async function readCompForQuality(workId: string) {
  const comp = await readCompositionFor({ workId });
  const worksRoot =
    process.env.AUTOVIRAL_WORKS_ROOT ??
    join(homedir(), ".autoviral/works");
  return { comp, workDir: join(worksRoot, workId) };
}

bridgeRouter.post("/quality/lint", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  try {
    const { comp, workDir } = await readCompForQuality(g.workId);
    return c.json({ ok: true, result: lintComposition(comp, { workDir }) });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

bridgeRouter.post("/quality/inspect", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  try {
    const { comp } = await readCompForQuality(g.workId);
    return c.json({ ok: true, result: inspectComposition(comp) });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

bridgeRouter.post("/quality/validate", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  try {
    const { comp } = await readCompForQuality(g.workId);
    return c.json({ ok: true, result: validateComposition(comp) });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

bridgeRouter.post("/quality/animation-map", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  try {
    const { comp } = await readCompForQuality(g.workId);
    return c.json({ ok: true, result: animationMap(comp) });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

bridgeRouter.post("/quality/check", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  try {
    const { comp, workDir } = await readCompForQuality(g.workId);
    const lint = lintComposition(comp, { workDir });
    const inspect = inspectComposition(comp);
    const validate = validateComposition(comp);
    const anim = animationMap(comp);
    const totalErrors = lint.counts.error + inspect.counts.error;
    const totalWarnings =
      lint.counts.warning + inspect.counts.warning + validate.counts.warning;
    return c.json({
      ok: true,
      result: {
        lint,
        inspect,
        validate,
        animationMap: anim,
        summary: {
          totalErrors,
          totalWarnings,
          exitCode: totalErrors > 0 ? 6 : totalWarnings > 0 ? 5 : 0,
        },
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

bridgeRouter.get("/trends", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const q = c.req.query();
  const platforms = q.platform
    ? (q.platform.split(",") as Array<
        "douyin" | "bilibili" | "youtube" | "xiaohongshu"
      >)
    : undefined;
  const trends = await getTrends({
    platforms,
    topic: q.topic,
  });
  return c.json({ ok: true, result: trends });
});

// SSE stream — every focus-changed event flushes the latest context.
// Native ReadableStream + text/event-stream for max portability across
// Hono adapters (works on both `node` and `bun` and Vercel-style runners).
bridgeRouter.get("/context/stream", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const workId = g.workId;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = async () => {
        try {
          const ctx = await getContext(workId);
          const payload = JSON.stringify({
            ...ctx,
            terminalInjectEnabled: readInject(workId),
          });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          // best-effort; do not tear down the stream on a transient read err
        }
      };
      // Initial snapshot
      void send();
      // Subscribe — every focus write fans out a re-snapshot.
      const unsub = subscribeFocus(workId, () => {
        void send();
      });
      // Keep-alive heartbeat every 25s to prevent some proxies from
      // closing idle SSE connections.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          /* closed */
        }
      }, 25_000);
      // Client-disconnect cleanup via c.req.raw.signal (Hono).
      const signal = c.req.raw.signal;
      const onAbort = () => {
        clearInterval(heartbeat);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      signal.addEventListener("abort", onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});

const InjectToggleSchema = z.object({
  enabled: z.boolean(),
});
bridgeRouter.post("/context/inject", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = InjectToggleSchema.parse(await c.req.json());
  writeInject(g.workId, body.enabled);
  broadcast(g.workId, "ui-context-inject", { enabled: body.enabled });
  return c.json({ ok: true, result: { enabled: body.enabled } });
});

// ─── H4.1 — TTS preprocess ──────────────────────────────────────────────────
// Synthesize narration audio via OpenAI's /v1/audio/speech endpoint.
// Drops the resulting mp3 (or wav/opus/etc.) into the work's
// assets/audio/ directory and broadcasts an asset-added event so the
// Studio UI picks it up immediately.
const TtsRequestSchema = z.object({
  text: z.string().min(1),
  voice: z.enum(TTS_VOICES).optional(),
  format: z.enum(TTS_FORMATS).optional(),
  model: z.string().optional(),
  filenameStem: z.string().optional(),
});

bridgeRouter.post("/preprocess/tts", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  try {
    const body = TtsRequestSchema.parse(await c.req.json());
    const worksRoot =
      process.env.AUTOVIRAL_WORKS_ROOT ??
      join(homedir(), ".autoviral/works");
    const workDir = join(worksRoot, g.workId);
    const result = await synthesizeTts({ ...body, workDir });
    broadcast(g.workId, "asset-added", {
      kind: "audio",
      uri: result.relativeUri,
      bytes: result.bytes,
      origin: "tts",
    });
    return c.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
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

// POST /export — wrap runRenderPipeline, stream progress via ui-render-
// progress events. Phase 5 hardens preset selection; Phase 3 just passes
// `--proxy` through for fast review renders.
bridgeRouter.post("/export", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = (await c.req.json().catch(() => ({}))) as {
    preset?: string;
    proxy?: boolean;
    // H2.2 — caller-supplied variable overrides applied before render
    variables?: Record<string, string | number | boolean>;
    strictVariables?: boolean;
  };
  try {
    const raw = await readCompositionFor({ workId: g.workId });
    // Resolve variables BEFORE render so the composition reaching Remotion
    // contains concrete values. resolve() is a no-op when raw.variables
    // is absent so existing works are unaffected.
    const { composition: comp, resolvedValues, issues } = resolveVariables(raw, {
      overrides: body.variables ?? {},
      strict: body.strictVariables === true,
    });
    // Output filename gets a short hash of the override JSON so multiple
    // variants don't clobber each other.
    const overrideHash =
      Object.keys(body.variables ?? {}).length > 0
        ? createHash("sha1")
            .update(JSON.stringify(resolvedValues))
            .digest("hex")
            .slice(0, 8)
        : null;
    const worksRoot =
      process.env.AUTOVIRAL_WORKS_ROOT ??
      join(homedir(), ".autoviral/works");
    const outDir = join(worksRoot, g.workId, "output");
    const finalPath = await runRenderPipeline({
      comp,
      outDir,
      proxy: body.proxy ?? false,
      // outputTitle becomes the filename stem; appending the hash keeps
      // variant outputs from clobbering each other.
      outputTitle: overrideHash ? `autoviral-export_${overrideHash}` : undefined,
      onProgress: (stage: RenderStage, pct: number) => {
        uiEventBus.publish(g.workId, {
          type: "ui-render-progress",
          workId: g.workId,
          ts: Date.now(),
          payload: { stage, pct },
        });
      },
    });
    return c.json({
      ok: true,
      result: { path: finalPath, resolvedValues, issues },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
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

// POST /ingest/youtube — download a YouTube URL into the current work,
// transcribe with Whisper, translate to the target language via OpenRouter,
// then bootstrap composition.yaml so the Studio can render the result.
// Long-running (download + ASR + translation can take minutes); progress
// is streamed over the bridge UI event bus, not via HTTP chunks.
bridgeRouter.post("/ingest/youtube", async (c) => {
  const got = workIdOrError(c);
  if (!got.ok) return got.res;
  type IngestBody = { url?: string; language?: string; model?: string; start?: number; end?: number };
  const body = (await c.req.json<IngestBody>().catch(() => ({} as IngestBody))) as IngestBody;
  if (!body.url || typeof body.url !== "string") {
    return c.json({ ok: false, error: "Body must include { url: string }" }, 400);
  }
  const result = await ingestYouTubeIntoWork({
    workId: got.workId,
    url: body.url,
    targetLanguage: body.language ?? "zh-CN",
    translateModel: body.model,
    startSec: typeof body.start === "number" ? body.start : undefined,
    endSec: typeof body.end === "number" ? body.end : undefined,
  });
  if (!result.ok) {
    return c.json({ ok: false, step: result.step, error: result.error, code: (result as any).code }, 500);
  }
  return c.json({ ok: true, result });
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

// AutoViral Bridge router — mounts at /api/bridge/v1.
// Phase 0: whoami only (smoke test of the wire). Phase 2-3 expand to
// read-only (comp/list/docs) + writes (clip add/set/remove) + UI commands
// (select/seek/play/pause/toast/progress) + approval gate (ask) + tasks
// (export/render). See docs/archive/specs/2026-05-14-agentic-terminal-
// bridge-protocol.md for the full surface.

import { Hono, type Context } from "hono";
import { homedir } from "node:os";
import { join, resolve, relative, sep } from "node:path";
import { PACKAGE_ROOT } from "../../infra/paths.js";
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
import { mutateCarouselFor } from "./carousel-ops.js";
// ADR-009 (S6) — shared composition-ops core. POST /split delegates the split
// math + invariants to `ops.splitClip` (the SAME implementation the studio
// store calls), so the agent-driven write path and the UI path can never drift.
import * as ops from "../../shared/composition/ops/index.js";
import { CompositionOpError } from "../../shared/composition/ops/index.js";
import {
  LayerSchema,
  SlideBgSchema,
  makeEmptySlide,
  genLayerId,
  type Slide,
  type Layer,
} from "../../shared/carousel.js";
import { uiEventBus } from "./ui-events.js";
import { randomBytes } from "node:crypto";
import { runRenderPipeline, type RenderStage } from "../render-pipeline.js";
import { resolvePlatformPreset } from "../../shared/platform-presets.js";
import { renderSnapshot } from "../snapshot.js";
import { listCheckpoints, restoreCheckpoint } from "../checkpoints.js";
import { ingestYouTubeIntoWork } from "./ingest-youtube.js";
import {
  read as readFocus,
  write as writeFocus,
  subscribe as subscribeFocus,
} from "../../focus/index.js";
import { resolve as resolveVariables } from "../../composition/variables/index.js";
import { synthesizeNarration } from "../../providers/tts/registry.js";
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
// Synthesize narration audio through the unified TTS registry (ADR-007): edge-
// tts first, OpenAI as the keyed fallback. Drops the audio into the work's
// assets/audio/ directory and broadcasts an asset-added event so the Studio UI
// picks it up immediately. `voice` is an edge voice id (e.g.
// "zh-CN-XiaoxiaoNeural"); the openai fallback maps it to a gender-matched voice.
const TtsRequestSchema = z.object({
  text: z.string().min(1),
  voice: z.string().optional(),
  format: z.string().optional(),
  language: z.string().optional(),
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
    const result = await synthesizeNarration({ ...body, workDir });
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
  if (!body.track) return c.json({ ok: false, error: "missing track", code: 4 }, 400);
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
    },
    // S2 (US 17) — explicit write-path broadcast. Only fires after the
    // atomic write lands on disk, so Studio refetches the new composition
    // without waiting on fs.watch (which is silent on missing dirs and
    // flaky on macOS rename events). fs.watch is now just a backstop.
    () => broadcast(g.workId, "composition-changed", { reason: "clip-add" }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // S3 (US 18/19) — input/validation rejection carries code:4 so the CLI
    // branches to exit 4 (vs 5xx service errors → exit 3).
    return c.json({ ok: false, error: message, code: 4 }, 400);
  }
  return c.json({ ok: true, result: { id: newId } });
});

bridgeRouter.delete("/clip/:id", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const id = c.req.param("id");
  try {
    await mutateCompositionFor(
      { workId: g.workId },
      (comp) => ({
        ...comp,
        tracks: comp.tracks.map((t) => ({
          ...t,
          clips: t.clips.filter((cl: any) => cl.id !== id),
        })),
      }) as any,
      // S2 (US 17) — broadcast only after the atomic write lands.
      () => broadcast(g.workId, "composition-changed", { reason: "clip-remove" }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // S3 (US 18/19) — input/validation rejection carries code:4.
    return c.json({ ok: false, error: message, code: 4 }, 400);
  }
  return c.json({ ok: true });
});

// S6 (US 1/9) — POST /split: the first intent-level verb that goes through the
// shared composition-ops core. Body `{ clipId, at }` splits the clip whose
// time-range contains `at` into two halves, rebasing keyframes. The split math
// + invariants are `ops.splitClip` — the EXACT implementation the studio store
// runs — so an agent splitting via the CLI and a human splitting in the UI
// produce an identical composition. Illegal params (unknown id / out-of-clip /
// boundary) throw CompositionOpError{code:4} → HTTP 400 + code:4 → CLI exit 4.
bridgeRouter.post("/split", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = (await c.req.json().catch(() => ({}))) as {
    clipId?: unknown;
    at?: unknown;
  };
  if (typeof body.clipId !== "string" || !body.clipId) {
    return c.json({ ok: false, error: "missing clipId", code: 4 }, 400);
  }
  if (typeof body.at !== "number" || !Number.isFinite(body.at)) {
    return c.json({ ok: false, error: "missing/invalid at (seconds)", code: 4 }, 400);
  }
  const clipId = body.clipId;
  const at = body.at;
  let newId = "";
  try {
    await mutateCompositionFor(
      { workId: g.workId },
      (comp) => {
        const { newClipId } = ops.splitClip(comp, { clipId, atSec: at });
        newId = newClipId;
        return comp;
      },
      // S2 (US 17) — broadcast only after the atomic write lands so Studio
      // refetches the two new clips without waiting on fs.watch.
      () => broadcast(g.workId, "composition-changed", { reason: "clip-split" }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // CompositionOpError carries its own code (4 for the split guards); fall
    // back to 4 for any other validation-class throw on this write path.
    const code = err instanceof CompositionOpError ? err.code : 4;
    return c.json({ ok: false, error: message, code }, 400);
  }
  return c.json({ ok: true, result: { id: newId } });
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
  // S15 (US 22/23/24) — resolve `--preset` against the @shared single-source
  // table BEFORE any work. An unknown name is a caller error: fail loud with
  // 400 + code:4 (S3 contract) instead of silently rendering the comp's old
  // settings (the dead-control bug this slice kills). A blank/omitted preset
  // means "use the comp's own exportPresets[0]" — unchanged legacy behaviour.
  let preset: ReturnType<typeof resolvePlatformPreset>;
  if (body.preset != null && String(body.preset).trim().length > 0) {
    preset = resolvePlatformPreset(body.preset);
    if (!preset) {
      return c.json(
        { ok: false, error: `unknown preset: ${body.preset}`, code: 4 },
        400,
      );
    }
  }
  try {
    const raw = await readCompositionFor({ workId: g.workId });
    // Resolve variables BEFORE render so the composition reaching Remotion
    // contains concrete values. resolve() is a no-op when raw.variables
    // is absent so existing works are unaffected.
    const resolved = resolveVariables(raw, {
      overrides: body.variables ?? {},
      strict: body.strictVariables === true,
    });
    const { resolvedValues, issues } = resolved;
    // When a preset was supplied, fold its canvas + encode settings into the
    // composition so render-pipeline's encode stage (reads exportPresets[0])
    // and canvas dimensions follow the platform. The loudness LUFS is passed
    // out-of-band to runRenderPipeline (loudnorm stage reads it, not the comp).
    const comp = preset
      ? {
          ...resolved.composition,
          width: preset.width,
          height: preset.height,
          fps: preset.fps as typeof resolved.composition.fps,
          exportPresets: [preset],
        }
      : resolved.composition;
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
      // S15 — drive the loudnorm stage from the resolved preset. Without this
      // the pipeline always fell back to its -14 default, so 微信(-16) etc.
      // were unreachable via /export (issue #80). Omitted when no preset so
      // legacy works keep the prior -14 behaviour.
      loudnessTargetLufs: preset?.loudnessTargetLufs,
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

// POST /snapshot — I21. Capture the CURRENT frame (video, via Remotion
// renderStill at the playhead or --at <seconds>) or the current slide
// (carousel, --slide <id>) as a PNG and return its absolute path. The CLI
// prints the path so the agent can Read it and visually self-check the output
// before declaring done (invariant #6 — verify what's visible, not the assumed
// artifact). Much faster than a full export: one frame, not the whole timeline.
bridgeRouter.post("/snapshot", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = (await c.req.json().catch(() => ({}))) as {
    at?: number;
    slide?: string;
  };
  try {
    const result = await renderSnapshot({
      workId: g.workId,
      at: typeof body.at === "number" ? body.at : undefined,
      slide: typeof body.slide === "string" ? body.slide : undefined,
    });
    return c.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

// ─── S21 (US 33/34) — agent-reachable checkpoint restore ─────────────────────
// Checkpoints are taken every agent turn (see ws-bridge per-turn createCheckpoint)
// but until now the agent had no verb to roll one BACK. These two endpoints give
// `autoviral checkpoint list|restore` a server surface so the agent can recover
// from a bad hand-edit safely.
//
// GET /checkpoints — list rollback history, newest first, including the optional
// #90 user label. Pure read.
bridgeRouter.get("/checkpoints", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  try {
    const result = await listCheckpoints(g.workId);
    return c.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

// POST /restore — roll the live deliverable back to a checkpoint. Body:
//   { file: "<ts>__<sha>__<deliverable>" }.
//
// CRITICAL (#68): restoreCheckpoint snapshots the CURRENT live state FIRST and
// only then overwrites it — restore is itself a destructive write, and the
// autosave path (PUT /composition) does NOT checkpoint, so a user's pending
// edits live ONLY in the live yaml. Pre-snapshotting makes restore reversible;
// the primitive throws (rather than swallows) if it can't preserve current
// state, so we surface that as a 500 instead of destroying data. A bad / unknown
// `file` returns null → 404 code:4 (input error per contracts/error-codes.md);
// the live deliverable is left UNTOUCHED. We broadcast composition/carousel
// "changed" so Studio refetches the rolled-back state without waiting on fs.watch.
bridgeRouter.post("/restore", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = (await c.req.json().catch(() => ({}))) as { file?: unknown };
  const file = typeof body.file === "string" ? body.file : "";
  if (!file) {
    return c.json({ ok: false, error: "restore requires a `file` field", code: 4 }, 400);
  }
  try {
    const result = await restoreCheckpoint(g.workId, file);
    if (result === null) {
      // Unknown / malformed filename, or no such snapshot on disk. Input error.
      return c.json({ ok: false, error: `no such checkpoint: ${file}`, code: 4 }, 404);
    }
    // Nudge the right preview to reload the rolled-back deliverable.
    const reason = "checkpoint-restore";
    if (result.deliverable === "carousel.yaml") {
      broadcast(g.workId, "carousel-changed", { reason });
    } else {
      broadcast(g.workId, "composition-changed", { reason });
    }
    return c.json({ ok: true, result });
  } catch (err) {
    // The #68 pre-restore snapshot failed (or copy failed) — we must NOT have
    // destroyed the live state. Report as a service error, not an input error.
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
    await mutateCompositionFor(
      { workId: g.workId },
      (comp) => ({
        ...comp,
        tracks: comp.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((cl: any) =>
            cl.id === id ? { ...cl, ...patch } : cl,
          ),
        })),
      }) as any,
      // S2 (US 17) — broadcast only after the atomic write lands.
      () => broadcast(g.workId, "composition-changed", { reason: "clip-set" }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // S3 (US 18/19) — input/validation rejection carries code:4.
    return c.json({ ok: false, error: message, code: 4 }, 400);
  }
  return c.json({ ok: true });
});

// ─── I08 — carousel write endpoints ─────────────────────────────────────────
// The carousel analogue of the clip endpoints. Both go through
// mutateCarouselFor which read-modifies-writes carousel.yaml atomically +
// validates the WHOLE carousel via CarouselSchema before it touches disk.
// On validation failure the mutator throws and disk state is left untouched —
// the only invariant the agent can chain on. Invalid input → HTTP 400
// `{ ok:false, error, code:4 }` → CLI exit 4 (per contracts/error-codes.md).
//
// Why two verbs: `add-slide` + `set-layer` are the carousel mutations that
// recur often enough to justify a round-trip. Richer mutations (reorder
// slides, restyle globals) are composed client-side and PUT as a full
// carousel via /api/works/:id/carousel.

// POST /carousel/slide — append a slide (optionally at an index). Body:
//   { at?: number, bg?: SlideBg }  — all optional; defaults to an empty
//   gradient slide appended at the end. Returns { id } of the new slide.
bridgeRouter.post("/carousel/slide", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const body = (await c.req.json().catch(() => ({}))) as {
    at?: number;
    bg?: unknown;
  };
  let newId = "";
  try {
    await mutateCarouselFor({ workId: g.workId }, (carousel) => {
      const slide: Slide = makeEmptySlide();
      if (body.bg !== undefined) {
        // Validate just the bg sub-shape eagerly so a bad --bg fails with a
        // pointed message rather than a whole-carousel zod dump. The final
        // CarouselSchema.parse in writeCarouselFor is the real gate.
        slide.bg = SlideBgSchema.parse(body.bg);
      }
      newId = slide.id;
      const at =
        typeof body.at === "number" && Number.isFinite(body.at)
          ? Math.max(0, Math.min(carousel.slides.length, Math.trunc(body.at)))
          : carousel.slides.length;
      const slides = [...carousel.slides];
      slides.splice(at, 0, slide);
      return { ...carousel, slides, updatedAt: new Date().toISOString() };
    },
    // S2 (US 17) — broadcast only after the atomic write lands so the
    // carousel preview refetches without waiting on fs.watch.
    () => broadcast(g.workId, "carousel-changed", { reason: "slide-add" }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message, code: 4 }, 400);
  }
  return c.json({ ok: true, result: { id: newId } });
});

// POST /carousel/slide/:slideId/layer — add or replace one layer on a slide.
// Body is a full Layer object (the discriminated union — { kind:"text"|...,
// box, ... }). If `id` is present and matches an existing layer it is
// REPLACED in place; otherwise a fresh id is minted and the layer appended.
// The layer is validated against LayerSchema (zod fills defaults) before the
// whole carousel is re-validated by writeCarouselFor. Returns { id }.
bridgeRouter.post("/carousel/slide/:slideId/layer", async (c) => {
  const g = workIdOrError(c);
  if (!g.ok) return g.res;
  const slideId = c.req.param("slideId");
  const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return c.json({ ok: false, error: "layer body must be a JSON object", code: 4 }, 400);
  }
  let layerId = "";
  try {
    await mutateCarouselFor({ workId: g.workId }, (carousel) => {
      const idx = carousel.slides.findIndex((s) => s.id === slideId);
      if (idx === -1) throw new Error(`no slide with id "${slideId}"`);
      const slide = carousel.slides[idx];
      // Mint an id if none supplied; preserve a supplied id so a re-POST with
      // the same id is an idempotent replace (not a duplicate append).
      const incomingId =
        typeof raw.id === "string" && raw.id.length > 0 ? raw.id : genLayerId();
      // LayerSchema is the discriminated union — it rejects an unknown `kind`
      // and fills per-kind style defaults. Parse here so a malformed layer
      // fails BEFORE we mutate the slide array.
      const layer: Layer = LayerSchema.parse({ ...raw, id: incomingId });
      layerId = layer.id;
      const existing = slide.layers.findIndex((l) => l.id === layer.id);
      const layers =
        existing === -1
          ? [...slide.layers, layer]
          : slide.layers.map((l, i) => (i === existing ? layer : l));
      const slides = carousel.slides.map((s, i) =>
        i === idx ? { ...s, layers } : s,
      );
      return { ...carousel, slides, updatedAt: new Date().toISOString() };
    },
    // S2 (US 17) — broadcast only after the atomic write lands.
    () => broadcast(g.workId, "carousel-changed", { reason: "layer-set" }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message, code: 4 }, 400);
  }
  return c.json({ ok: true, result: { id: layerId } });
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
      // I08 — subdir-aware topic resolution. A topic may now be a nested
      // chapter like `carousel/02-schema`; node's `join` resolves the `/`
      // into a real subdir path. We `resolve` both sides and verify the
      // target stays INSIDE the manual dir so a crafted `../../secret` topic
      // can't escape the manual tree.
      const rel = topic.endsWith(".md") ? topic : `${topic}.md`;
      const file = resolve(dir, rel);
      const within = relative(resolve(dir), file);
      if (within.startsWith("..") || within.startsWith(sep) || within === "") {
        return c.json({ ok: false, error: `invalid docs topic: ${topic}` }, 404);
      }
      const md = await readFile(file, "utf8");
      return c.text(md);
    }
    // No topic → concatenate the whole manual, recursing one level into
    // subdirs (e.g. carousel/) so a content-type's chapters are included.
    const files = await listManualMarkdown(dir);
    const chunks = await Promise.all(files.map((f) => readFile(join(dir, f), "utf8")));
    return c.text(chunks.join("\n\n---\n\n"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 404);
  }
});

// Collect markdown chapters under the manual dir, recursing one level into
// subdirectories (carousel/, etc.). Returns paths RELATIVE to `dir`, sorted
// so the dump order is stable (top-level chapters first, then subdir chapters).
async function listManualMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".md")) out.push(e.name);
    else if (e.isDirectory()) {
      const sub = await readdir(join(dir, e.name)).catch(() => [] as string[]);
      for (const f of sub) if (f.endsWith(".md")) out.push(`${e.name}/${f}`);
    }
  }
  return out.sort();
}

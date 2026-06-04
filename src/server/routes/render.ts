// Render domain sub-router (I11): render-job enqueue/get/cancel, OS reveal,
// and the ffmpeg cross-fade transition endpoints. Split verbatim from api.ts —
// no behaviour/path change.

import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { getWork } from "../../domain/work-store.js";
import { dataDir } from "../../infra/config.js";
import { join } from "node:path";
import { resolveAssetPath, UnsafePathError, SAFE_ID } from "../safe-paths.js";
import { getRenderQueue, findActiveRenderJob } from "./_shared.js";
import { FFPROBE_BIN } from "../ffmpeg-paths.js";

export const renderRouter = new Hono();

// POST /api/works/:id/render — enqueues a render job; the worker drains it.
// Phase 7.B — contract changed: now returns { jobId } (was { ok, output }).
// Body: { type?: "full"|"proxy", presetId?: string, burnSubtitles?: boolean,
//         loudnessTargetLufs?: number }
renderRouter.post("/api/works/:id/render", async (c) => {
  const id = c.req.param("id");
  const renderQueue = getRenderQueue();
  if (!renderQueue) {
    return c.json({ error: "RenderQueue not initialized", errorCode: "render_queue_unavailable" }, 503);
  }
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  // Cheap fail-fast: composition.yaml must exist on disk before we enqueue.
  // The worker re-loads + validates it via loadComposition; this just gives
  // the user a synchronous 409 instead of a queued-then-failed job.
  // e2e-report F128: status code is 409 Conflict (state precondition not met:
  // not-yet-saved composition vs. ready-to-render), NOT 400 Bad Request.
  // The request itself is well-formed — the *state* is incompatible with the
  // action. Misclassifying as 400 misled triage into "user sent bad data".
  try {
    await readFile(join(dataDir, "works", id, "composition.yaml"), "utf-8");
  } catch {
    return c.json({ error: "Composition missing — save first", errorCode: "composition_missing" }, 409);
  }
  const body = await c.req.json().catch(() => ({}));
  const type: "full" | "proxy" = body.type === "proxy" ? "proxy" : "full";
  // Phase H (#35) — pass through the per-track caption strategy when the
  // client supplied one. Shape: { burnTrackId?: string | null,
  // sidecarTrackIds?: string[] }. We only forward the keys that look like
  // strings/arrays — defensively ignore anything else so a malformed body
  // can't poison the worker's filter logic.
  let captionTracks:
    | { burnTrackId?: string | null; sidecarTrackIds?: string[] }
    | undefined;
  const raw = (body as { captionTracks?: unknown }).captionTracks;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    captionTracks = {
      burnTrackId:
        typeof r.burnTrackId === "string" || r.burnTrackId === null
          ? (r.burnTrackId as string | null)
          : undefined,
      sidecarTrackIds: Array.isArray(r.sidecarTrackIds)
        ? r.sidecarTrackIds.filter((x): x is string => typeof x === "string")
        : undefined,
    };
  }
  // #62 — per-work render dedup (defense-in-depth behind the client's reentrancy
  // lock). If a render for this work is already queued/running, reuse its id so
  // a concurrent second POST is idempotent: the client attaches to the same
  // progress stream instead of spawning a parallel render that orphans the
  // first. A finished job means this is a fresh, intentional re-export → enqueue.
  const active = findActiveRenderJob(renderQueue, id);
  if (active) {
    return c.json({ jobId: active.id, deduped: true });
  }
  const job = renderQueue.enqueue({
    workId: id,
    type,
    presetId: typeof body.presetId === "string" ? body.presetId : undefined,
    burnSubtitles: !!body.burnSubtitles,
    loudnessTargetLufs:
      typeof body.loudnessTargetLufs === "number"
        ? body.loudnessTargetLufs
        : undefined,
    captionTracks,
  });
  return c.json({ jobId: job.id });
});

// GET /api/render/jobs/:id — Phase 7.B
renderRouter.get("/api/render/jobs/:id", (c) => {
  const renderQueue = getRenderQueue();
  if (!renderQueue) {
    return c.json({ error: "RenderQueue not initialized", errorCode: "render_queue_unavailable" }, 503);
  }
  const job = renderQueue.get(c.req.param("id"));
  if (!job) return c.json({ error: "Job not found", errorCode: "render_job_not_found" }, 404);
  return c.json(job);
});

// DELETE /api/render/jobs/:id — Phase 7.B
// Cancels a queued or running job. D9: cancelling queued is synchronous;
// running jobs receive an AbortSignal which the pipeline honours.
renderRouter.delete("/api/render/jobs/:id", (c) => {
  const renderQueue = getRenderQueue();
  if (!renderQueue) {
    return c.json({ error: "RenderQueue not initialized", errorCode: "render_queue_unavailable" }, 503);
  }
  const id = c.req.param("id");
  renderQueue.cancel(id);
  const job = renderQueue.get(id);
  if (!job) return c.json({ error: "Job not found", errorCode: "render_job_not_found" }, 404);
  return c.json(job);
});

// POST /api/render/reveal — R43. Reveal a render output in the OS file
// browser (Finder on macOS, Explorer on Windows, xdg-open on Linux).
// Body: { workId, filename }. Returns { ok: true } on success or 501 if
// the platform isn't supported. Constrained to filenames inside
// <workDir>/output/ so an injection-safe filename can't escape.
renderRouter.post("/api/render/reveal", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const workId = String(body.workId ?? "");
  const filename = String(body.filename ?? "");
  if (!SAFE_ID.test(workId)) {
    return c.json({ error: "Invalid workId", errorCode: "invalid_work_id" }, 400);
  }
  // Hard-fail any path-traversal attempts; resolveAssetPath also enforces
  // this via UnsafePathError, but earlier rejection produces a clearer
  // 400 and avoids touching the FS.
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.startsWith(".")) {
    return c.json({ error: "Invalid filename", errorCode: "invalid_filename" }, 400);
  }
  let absolutePath: string;
  try {
    absolutePath = resolveAssetPath(workId, "output", filename);
  } catch (err) {
    if (err instanceof UnsafePathError) {
      return c.json({ error: err.message, errorCode: "invalid_path" }, 400);
    }
    throw err;
  }
  // Confirm the file actually exists before invoking the OS — otherwise
  // we'd open Finder on a missing path which is just confusing.
  try {
    const { stat } = await import("node:fs/promises");
    await stat(absolutePath);
  } catch {
    return c.json({ error: "Output file not found", errorCode: "output_not_found" }, 404);
  }
  const platform = process.platform;
  // execFile with separate args (NOT `exec` with shell=true) so the file
  // path can't be parsed as shell metacharacters even if it slipped past
  // the safety checks above.
  try {
    if (platform === "darwin") {
      // -R reveals the file in Finder (selects it inside its folder)
      // rather than opening the file itself in QuickTime.
      await new Promise<void>((res, rej) => {
        execFile("open", ["-R", absolutePath], (err) =>
          err ? rej(err) : res(),
        );
      });
      return c.json({ ok: true, platform });
    }
    if (platform === "win32") {
      await new Promise<void>((res, rej) => {
        execFile("explorer", [`/select,${absolutePath}`], (err) =>
          err ? rej(err) : res(),
        );
      });
      return c.json({ ok: true, platform });
    }
    if (platform === "linux") {
      // xdg-open opens the *containing folder*; selecting the file
      // depends on the file manager (nautilus supports --select but
      // dolphin uses different flags). Folder-only is the safe baseline.
      const { dirname } = await import("node:path");
      await new Promise<void>((res, rej) => {
        execFile("xdg-open", [dirname(absolutePath)], (err) =>
          err ? rej(err) : res(),
        );
      });
      return c.json({ ok: true, platform });
    }
    return c.json(
      { error: `reveal unsupported on ${platform}`, errorCode: "reveal_unsupported_platform" },
      501,
    );
  } catch (err: any) {
    return c.json(
      { error: `reveal failed: ${err?.message ?? String(err)}`, errorCode: "reveal_failed" },
      500,
    );
  }
});

// POST /api/transitions/* — R46 #5. Cinematic cross-fade transitions
// between two clips. Pure ffmpeg (no GLSL); agent invokes when the
// assembly module wants editorial-style cuts between scenes.
//
// Body: {
//   workId, clipARelative, clipBRelative, outputFilename,
//   clipADuration: seconds, transitionDuration?: seconds (default 0.8)
// }
// All paths are work-relative (e.g. "assets/clips/intro.mp4"); resolved
// safely via resolveAssetPath. Output writes to <workDir>/output/<file>.

type TransitionApplyFn = (opts: {
  clipA: string;
  clipB: string;
  outputPath: string;
  clipADuration: number;
  transitionDuration: number;
  width: number;
  height: number;
  fps: number;
}) => Promise<string>;

async function runTransitionEndpoint(c: any, applyFn: TransitionApplyFn) {
  const body = await c.req.json().catch(() => ({}));
  const workId = String(body.workId ?? "");
  const clipARel = String(body.clipARelative ?? "");
  const clipBRel = String(body.clipBRelative ?? "");
  const outputFilename = String(body.outputFilename ?? "");
  const clipADuration = Number(body.clipADuration);
  const transitionDuration = Number(body.transitionDuration ?? 0.8);

  if (!SAFE_ID.test(workId)) {
    return c.json({ error: "Invalid workId", errorCode: "invalid_work_id" }, 400);
  }
  if (!clipARel || !clipBRel || !outputFilename) {
    return c.json(
      { error: "Missing clipARelative/clipBRelative/outputFilename", errorCode: "invalid_params" },
      400,
    );
  }
  if (!Number.isFinite(clipADuration) || clipADuration <= 0) {
    return c.json(
      { error: "clipADuration must be a positive number (seconds)", errorCode: "invalid_params" },
      400,
    );
  }
  if (transitionDuration <= 0 || transitionDuration >= clipADuration) {
    return c.json(
      {
        error: "transitionDuration must be > 0 and < clipADuration",
        errorCode: "invalid_params",
      },
      400,
    );
  }
  // Path-traversal defence — same pattern as reveal endpoint.
  if (
    outputFilename.includes("/") ||
    outputFilename.includes("\\") ||
    outputFilename.startsWith(".")
  ) {
    return c.json(
      { error: "Invalid outputFilename", errorCode: "invalid_filename" },
      400,
    );
  }

  let clipA: string;
  let clipB: string;
  let outPath: string;
  try {
    const resolvePath = (rel: string) => {
      const cleaned = rel.replace(/^\/+/, "");
      const root = cleaned.startsWith("output/") ? "output" : "assets";
      const rest = cleaned.startsWith("output/")
        ? cleaned.slice(7)
        : cleaned.startsWith("assets/")
          ? cleaned.slice(7)
          : cleaned;
      return resolveAssetPath(workId, root, rest);
    };
    clipA = resolvePath(clipARel);
    clipB = resolvePath(clipBRel);
    outPath = resolveAssetPath(workId, "output", outputFilename);
  } catch (err) {
    if (err instanceof UnsafePathError) {
      return c.json({ error: err.message, errorCode: "invalid_path" }, 400);
    }
    throw err;
  }

  // Probe clipA dimensions so we can size overlays / passes correctly.
  const { execFile } = await import("node:child_process");
  const { promisify: p } = await import("node:util");
  const ef = p(execFile);
  let width = 1080;
  let height = 1920;
  let fps = 30;
  try {
    const { stdout } = await ef(FFPROBE_BIN, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,r_frame_rate",
      "-of", "default=noprint_wrappers=1",
      clipA,
    ]);
    for (const line of stdout.split("\n")) {
      const [k, v] = line.split("=");
      if (k === "width") width = parseInt(v ?? "1080", 10) || 1080;
      else if (k === "height") height = parseInt(v ?? "1920", 10) || 1920;
      else if (k === "r_frame_rate") {
        // r_frame_rate is "num/den" e.g. "30/1"; eval it.
        const [n, d] = (v ?? "30/1").split("/").map(Number);
        if (n && d) fps = Math.round(n / d);
      }
    }
  } catch {
    // ffprobe failure means clipA is unreadable; let the apply fn fail
    // with the actual ffmpeg error rather than guessing.
  }

  try {
    const result = await applyFn({
      clipA,
      clipB,
      outputPath: outPath,
      clipADuration,
      transitionDuration,
      width,
      height,
      fps,
    });
    return c.json({
      ok: true,
      outputPath: result,
      previewUrl: `/api/works/${workId}/assets/output/${encodeURIComponent(outputFilename)}`,
    });
  } catch (err: any) {
    return c.json(
      { error: err?.message ?? String(err), errorCode: "transition_failed" },
      500,
    );
  }
}

renderRouter.post("/api/transitions/light-leak", async (c) => {
  const { applyLightLeakTransition } = await import("../render/transitions.js");
  return runTransitionEndpoint(c, applyLightLeakTransition);
});

renderRouter.post("/api/transitions/glitch", async (c) => {
  const { applyGlitchCutTransition } = await import("../render/transitions.js");
  return runTransitionEndpoint(c, applyGlitchCutTransition);
});

renderRouter.post("/api/transitions/domain-warp", async (c) => {
  const { applyDomainWarpTransition } = await import("../render/transitions.js");
  return runTransitionEndpoint(c, applyDomainWarpTransition);
});

renderRouter.post("/api/transitions/grav-lens", async (c) => {
  const { applyGravLensTransition } = await import("../render/transitions.js");
  return runTransitionEndpoint(c, applyGravLensTransition);
});

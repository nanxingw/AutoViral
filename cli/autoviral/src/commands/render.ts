// `autoviral render <enqueue|status|cancel|history|snapshot>` — the render-queue
// lifecycle CLI (PRD-0014 S11). The synchronous `autoviral export` path stays for
// blocking renders; these verbs drive the ASYNC queue the Studio's export button
// uses, so an agent can fire a render, poll its progress, cancel it, and inspect
// history WITHOUT hand-rolling curl against undocumented routes (#94 blocker 5:
// the status endpoint always existed at `GET /api/render/jobs/:id` but was a
// discoverability black box).
//
//   render enqueue [--preset <name>] [--proxy] [--caption-tracks A[,B,...]]
//       Enqueue an async render → prints the jobId. --caption-tracks passes
//       THROUGH to the queue body's { burnTrackId, sidecarTrackIds } shape:
//       the first track is burned into the video, the rest emit sidecar SRTs.
//   render status <jobId>     GET the job (status + 0..1 progress).
//   render cancel <jobId>     Cancel a queued/running job.
//   render history            List this work's jobs.
//   render snapshot --frame N [--out <png>]
//       Cheap single-frame ground-truth self-check (remotion-still, NOT a full
//       export). Prints the PNG path so you can Read it.
//
// Back-compat: a bare `autoviral render` (or `render` + flags) with no known
// subverb keeps aliasing to `export --proxy` (the pre-S11 behaviour).

import { readContext, apiJson, apiJsonAbs, bridgeRequest } from "../client.js";
import { writeOut, parseFormatFlag } from "../output.js";
import { exportCommand } from "./export.js";

// The render-queue job shape (mirrors src/server/render-queue/job.ts::RenderJob).
// We only type the fields the CLI surfaces; the whole bare object is printed.
interface RenderJob {
  id: string;
  workId: string;
  status: string;
  progress: number;
  [k: string]: unknown;
}

const RENDER_VERBS = new Set([
  "enqueue",
  "status",
  "cancel",
  "history",
  "snapshot",
]);

export async function renderCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub && RENDER_VERBS.has(sub)) {
    const rest = args.slice(1);
    switch (sub) {
      case "enqueue":
        return renderEnqueue(rest);
      case "status":
        return renderStatus(rest);
      case "cancel":
        return renderCancel(rest);
      case "history":
        return renderHistory(rest);
      case "snapshot":
        return renderSnapshotVerb(rest);
    }
  }
  // Legacy alias — `autoviral render [flags]` == `export --proxy` (synchronous
  // proxy render). Preserved for un-migrated review scripts.
  return exportCommand([...args, "--proxy"]);
}

// ── render enqueue ──────────────────────────────────────────────────────────
async function renderEnqueue(args: string[]): Promise<void> {
  let preset: string | undefined;
  let proxy = false;
  let captionTracks: string[] | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--proxy") proxy = true;
    else if (a === "--preset") preset = args[++i];
    else if (a === "--caption-tracks") {
      const raw = args[++i] ?? "";
      const tracks = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (tracks.length === 0) {
        process.stderr.write(
          "autoviral render enqueue: --caption-tracks needs at least one track id (e.g. t_zh or t_zh,t_en)\n",
        );
        process.exit(4);
      }
      captionTracks = tracks;
    } else if (a.startsWith("--")) {
      process.stderr.write(`autoviral: unknown flag ${a}\n`);
      process.exit(4);
    }
  }
  const ctx = readContext();
  const body: Record<string, unknown> = {
    // The queue route reads `type` ("proxy" | else "full").
    type: proxy ? "proxy" : "full",
  };
  if (preset !== undefined) body.presetId = preset;
  if (captionTracks) {
    // Pass through to the queue's caption strategy: first track burned in, the
    // rest emitted as sidecar SRTs (mirrors the export --caption-tracks order).
    const [burnTrackId, ...sidecarTrackIds] = captionTracks;
    body.captionTracks = { burnTrackId, sidecarTrackIds };
  }
  // POST /api/works/:id/render → bare { jobId } (NOT the bridge envelope).
  const result = await apiJson<{ jobId: string; deduped?: boolean }>(
    ctx,
    "POST",
    "/render",
    body,
  );
  process.stdout.write(`${result.jobId}\n`);
  if (result.deduped) {
    // A render for this work was already in flight — we attached to it rather
    // than spawn a parallel one (#62). Note it on stderr so stdout stays a clean
    // jobId for `$(autoviral render enqueue)` substitution.
    process.stderr.write(
      "autoviral render enqueue: a render for this work was already queued/running — attached to the existing job\n",
    );
  }
}

// ── render status <jobId> ───────────────────────────────────────────────────
async function renderStatus(args: string[]): Promise<void> {
  const jobId = args.find((a) => !a.startsWith("--"));
  if (!jobId) {
    process.stderr.write("autoviral render status: needs a <jobId>\n");
    process.exit(4);
  }
  const ctx = readContext();
  const job = await apiJsonAbs<RenderJob>(
    ctx,
    "GET",
    `/api/render/jobs/${encodeURIComponent(jobId)}`,
  );
  writeOut(job, parseFormatFlag(args));
}

// ── render cancel <jobId> ───────────────────────────────────────────────────
async function renderCancel(args: string[]): Promise<void> {
  const jobId = args.find((a) => !a.startsWith("--"));
  if (!jobId) {
    process.stderr.write("autoviral render cancel: needs a <jobId>\n");
    process.exit(4);
  }
  const ctx = readContext();
  const job = await apiJsonAbs<RenderJob>(
    ctx,
    "DELETE",
    `/api/render/jobs/${encodeURIComponent(jobId)}`,
  );
  writeOut(job, parseFormatFlag(args));
}

// ── render history ──────────────────────────────────────────────────────────
async function renderHistory(args: string[]): Promise<void> {
  const ctx = readContext();
  // GET /api/works/:id/render/jobs → { jobs } (newest-first server-side).
  const result = await apiJson<{ jobs: RenderJob[] }>(ctx, "GET", "/render/jobs");
  writeOut(result, parseFormatFlag(args));
}

// ── render snapshot --frame N [--out <png>] ─────────────────────────────────
async function renderSnapshotVerb(args: string[]): Promise<void> {
  let frame: number | undefined;
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--frame") {
      const raw = args[++i];
      const n = Number(raw);
      if (raw === undefined || !Number.isFinite(n)) {
        process.stderr.write(
          `autoviral render snapshot: --frame needs an integer frame index (got ${raw ?? "nothing"})\n`,
        );
        process.exit(4);
      }
      frame = n;
    } else if (a === "--out") {
      out = args[++i];
      if (out === undefined) {
        process.stderr.write("autoviral render snapshot: --out needs a filename\n");
        process.exit(4);
      }
    } else if (a === "--format") {
      i++; // consumed by parseFormatFlag; skip its value here
    } else if (a.startsWith("--")) {
      process.stderr.write(`autoviral: unknown flag ${a}\n`);
      process.exit(4);
    }
  }
  if (frame === undefined) {
    process.stderr.write(
      "autoviral render snapshot: --frame <N> is required (use `autoviral snapshot --at <time>` for a time-based still)\n",
    );
    process.exit(4);
  }
  const ctx = readContext();
  const body: Record<string, unknown> = { frame };
  if (out !== undefined) body.out = out;
  const result = await bridgeRequest<{
    path: string;
    kind: string;
    textLayersComposited?: boolean;
  }>(ctx, "POST", "/snapshot", body);
  // Clean absolute path on its own line for `$(autoviral render snapshot ...)`.
  process.stdout.write(`${result.path}\n`);
  if (result.textLayersComposited === false) {
    process.stderr.write(
      "⚠ snapshot shows the background only; text/sticker layers are NOT composited — do not infer text layout/overflow from this image.\n",
    );
  }
}

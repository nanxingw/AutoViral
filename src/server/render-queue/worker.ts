// src/server/render-queue/worker.ts

import { EventEmitter } from "node:events";
import type { RenderQueueStore } from "./store.js";
import type { RenderJob, RenderStage } from "./job.js";
import { isTerminalStatus } from "./job.js";

// R43 / R46 — pipeline stage order matching render-pipeline.ts onP() calls.
// R43 split progress into equal 1/N slices to fix the "stage transitions
// reset progress to 0" bug. R46 replaces the equal split with weighted
// budgets so the bar reflects actual wall-clock time per stage:
//
// Equal split lied to the user: render is 5-10 min and the other 4
// stages combined are <30s. Visible progress would race 0→20%, then
// hang at 20% for the entire render, then race 80→100% in <30s.
//
// Weighted budget mirrors heygen-com/hyperframes producer/
// renderOrchestrator.ts stage layout — the bar advances at roughly the
// same wall-clock rate per percent across the whole pipeline. Budget
// sum = 1.0 by construction (asserted at module init).
const STAGE_ORDER: readonly RenderStage[] = [
  "render",
  "duck",
  "loudnorm",
  "burn",
  "encode",
];

const STAGE_BUDGET: Record<RenderStage, number> = {
  // Render dominates — Chromium screenshots + frame compose. ~75% of
  // wall-clock on full-quality export.
  render: 0.75,
  // Sidechain duck — single ffmpeg pass over the audio mix. ~5%.
  duck: 0.05,
  // Loudnorm two-pass — analyse + apply, audio-only, fast. ~5%.
  loudnorm: 0.05,
  // Burn subtitles — single ffmpeg pass with libass overlay. ~5%.
  burn: 0.05,
  // Final encode — with R46 GPU encoder active this is fast; without
  // it (libx264 software) it can rival render. ~10% midpoint.
  encode: 0.1,
};

// Sanity at module init — if a future edit drops a stage from the
// budget the imbalance becomes a runtime invariant violation, not a
// silent UI regression.
{
  const sum = Object.values(STAGE_BUDGET).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(`STAGE_BUDGET sum must be 1.0, got ${sum.toFixed(6)}`);
  }
}

export function aggregateProgress(stage: RenderStage, pct: number): number {
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx < 0) return Math.max(0, Math.min(1, pct));
  // Sum of all stages BEFORE this one (their full budget is "done").
  let cumulative = 0;
  for (let i = 0; i < idx; i++) {
    cumulative += STAGE_BUDGET[STAGE_ORDER[i]!];
  }
  const slice = STAGE_BUDGET[stage];
  const clamped = Math.max(0, Math.min(1, pct));
  return cumulative + clamped * slice;
}

export interface WorkerProgressEvent {
  at: string;
  status: RenderJob["status"];
  progress: number;
  stage?: RenderStage;
  log?: { at: string; level: "info" | "warn" | "error"; msg: string };
  /** R43 — emitted on the terminal "done" event so the client modal
   *  can show "open output" without polling the REST endpoint. */
  outputPath?: string;
}

export interface RunRenderPipelineLike {
  (opts: {
    comp: any;
    outDir: string;
    burnSubtitles?: boolean;
    loudnessTargetLufs?: number;
    proxy?: boolean;
    signal?: AbortSignal;
    onProgress?: (stage: RenderStage, pct: number) => void;
    captionTracks?: {
      burnTrackId?: string | null;
      sidecarTrackIds?: string[];
    };
  }): Promise<string>;
}

export interface JobExtras {
  burnSubtitles?: boolean;
  loudnessTargetLufs?: number;
  captionTracks?: {
    burnTrackId?: string | null;
    sidecarTrackIds?: string[];
  };
}

export interface WorkerDeps {
  store: RenderQueueStore;
  runRenderPipeline: RunRenderPipelineLike;
  loadComposition: (workId: string) => Promise<any>;
  outDirFor: (workId: string) => string;
  /** D3 — defaults to 1. Configurable via AUTOVIRAL_RENDER_CONCURRENCY env var (handled by caller). */
  concurrency?: number;
  /** Phase H (#35) — pull runtime-only options (captionTracks, etc.) that
   *  weren't persisted with the job row. Returns undefined for legacy jobs. */
  extrasFor?: (jobId: string) => JobExtras | undefined;
  /** Phase H (#35) — invoked once a job reaches a terminal status so the
   *  caller can release whatever held the extras (memory map, weak ref, etc). */
  clearExtras?: (jobId: string) => void;
}

export class RenderQueueWorker {
  private readonly emitter = new EventEmitter();
  private readonly inflight = new Map<string, AbortController>();
  private readonly concurrency: number;
  private started = false;
  private draining = false;
  private wakeup: () => void = () => {};

  constructor(private readonly deps: WorkerDeps) {
    this.concurrency = Math.max(1, deps.concurrency ?? 1);
    this.emitter.setMaxListeners(0);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.drain();
  }

  stop(): void {
    this.started = false;
    this.stopped = true;
    for (const ac of this.inflight.values()) ac.abort();
    this.wakeup();
  }

  private stopped = false;

  on(jobId: string, fn: (ev: WorkerProgressEvent) => void): () => void {
    const handler = (ev: WorkerProgressEvent) => fn(ev);
    this.emitter.on(`job:${jobId}`, handler);
    return () => this.emitter.off(`job:${jobId}`, handler);
  }

  /** Wake the drain loop after enqueue. */
  notify(): void {
    this.wakeup();
  }

  cancel(jobId: string): void {
    const job = this.deps.store.get(jobId);
    if (!job) return;
    if (isTerminalStatus(job.status)) return;
    if (job.status === "queued") {
      this.deps.store.update(jobId, { status: "cancelled" });
      this.emit(jobId, { status: "cancelled", progress: job.progress });
      return;
    }
    const ac = this.inflight.get(jobId);
    if (ac) ac.abort();
    // Final status flip happens inside drain() when the runner rejects.
  }

  private emit(
    jobId: string,
    partial: Omit<WorkerProgressEvent, "at">,
  ): void {
    const ev: WorkerProgressEvent = {
      at: new Date().toISOString(),
      ...partial,
    };
    try {
      this.emitter.emit(`job:${jobId}`, ev);
    } catch {
      /* swallow listener errors */
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.started) {
        const id = this.deps.store.nextQueued();
        if (!id) {
          await new Promise<void>((res) => {
            this.wakeup = () => {
              this.wakeup = () => {};
              res();
            };
            setTimeout(() => this.wakeup(), 100);
          });
          continue;
        }
        if (this.inflight.size >= this.concurrency) {
          await new Promise((res) => setTimeout(res, 50));
          continue;
        }
        await this.runOne(id);
      }
    } finally {
      this.draining = false;
    }
  }

  private async runOne(jobId: string): Promise<void> {
    const job = this.deps.store.get(jobId);
    if (!job || job.status !== "queued") return;
    this.deps.store.update(jobId, { status: "running", progress: 0 });
    this.emit(jobId, { status: "running", progress: 0 });

    const ac = new AbortController();
    this.inflight.set(jobId, ac);

    let comp: any;
    try {
      comp = await this.deps.loadComposition(job.workId);
    } catch (err: any) {
      this.deps.store.update(jobId, {
        status: "failed",
        error: `loadComposition: ${err?.message ?? String(err)}`,
      });
      this.emit(jobId, { status: "failed", progress: 0 });
      this.inflight.delete(jobId);
      return;
    }

    // Phase H (#35) — pull runtime-only options (captionTracks, etc.)
    // out of the queue's in-memory side channel. Legacy jobs return
    // undefined and fall back to the existing single-track render path.
    const extras = this.deps.extrasFor?.(jobId);

    try {
      const out = await this.deps.runRenderPipeline({
        comp,
        outDir: this.deps.outDirFor(job.workId),
        proxy: job.type === "proxy",
        signal: ac.signal,
        burnSubtitles: extras?.burnSubtitles,
        loudnessTargetLufs: extras?.loudnessTargetLufs,
        captionTracks: extras?.captionTracks,
        onProgress: (stage, pct) => {
          if (this.stopped) return;
          // R43 — aggregate progress across the 5 pipeline stages so the
          // bar advances monotonically instead of resetting to 0 between
          // stages. Pre-fix, each stage emitted onP(stage, 0) on entry,
          // which clobbered the just-completed stage's onP(prev, 1) and
          // pulled the visible progress back to 0. Users saw "stages
          // tick by while progress bar stays at 0%" — exactly the bug
          // reported on 2026-05-09.
          //
          // Mapping mirrors the order in render-pipeline.ts: render →
          // duck → loudnorm → burn → encode. Each stage owns 0.2 of the
          // total, and intra-stage pct linearly maps into that slice.
          const aggregated = aggregateProgress(stage, pct);
          this.deps.store.update(jobId, { stage, progress: aggregated });
          this.emit(jobId, { status: "running", progress: aggregated, stage });
        },
      });
      if (this.stopped) return;
      // If cancel was requested between progress events and resolve, treat as cancelled.
      if (ac.signal.aborted) {
        this.deps.store.update(jobId, { status: "cancelled" });
        this.emit(jobId, { status: "cancelled", progress: 1 });
      } else {
        this.deps.store.update(jobId, {
          status: "done",
          progress: 1,
          outputPath: out,
        });
        // R43 — include outputPath in the terminal event so the
        // ExportProgress modal can render an "open output" affordance
        // without an extra round-trip. Pre-fix, only the snapshot frame
        // (sent on socket open) carried outputPath; if the user's modal
        // was already open during the run, it never received the path.
        this.emit(jobId, { status: "done", progress: 1, outputPath: out });
      }
    } catch (err: any) {
      if (this.stopped) return;
      if (ac.signal.aborted) {
        this.deps.store.update(jobId, { status: "cancelled" });
        this.emit(jobId, { status: "cancelled", progress: 0 });
      } else {
        const msg = err?.message ?? String(err);
        this.deps.store.update(jobId, { status: "failed", error: msg });
        this.emit(jobId, { status: "failed", progress: 0 });
      }
    } finally {
      this.inflight.delete(jobId);
      // Phase H (#35) — release the extras side-channel entry. Job has
      // reached a terminal status (done/failed/cancelled) above.
      this.deps.clearExtras?.(jobId);
    }
  }
}

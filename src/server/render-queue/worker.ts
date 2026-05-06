// src/server/render-queue/worker.ts

import { EventEmitter } from "node:events";
import type { RenderQueueStore } from "./store.js";
import type { RenderJob, RenderStage } from "./job.js";
import { isTerminalStatus } from "./job.js";

export interface WorkerProgressEvent {
  at: string;
  status: RenderJob["status"];
  progress: number;
  stage?: RenderStage;
  log?: { at: string; level: "info" | "warn" | "error"; msg: string };
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
  }): Promise<string>;
}

export interface WorkerDeps {
  store: RenderQueueStore;
  runRenderPipeline: RunRenderPipelineLike;
  loadComposition: (workId: string) => Promise<any>;
  outDirFor: (workId: string) => string;
  /** D3 — defaults to 1. Configurable via AUTOVIRAL_RENDER_CONCURRENCY env var (handled by caller). */
  concurrency?: number;
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

    try {
      const out = await this.deps.runRenderPipeline({
        comp,
        outDir: this.deps.outDirFor(job.workId),
        proxy: job.type === "proxy",
        signal: ac.signal,
        onProgress: (stage, pct) => {
          if (this.stopped) return;
          this.deps.store.update(jobId, { stage, progress: pct });
          this.emit(jobId, { status: "running", progress: pct, stage });
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
        this.emit(jobId, { status: "done", progress: 1 });
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
    }
  }
}

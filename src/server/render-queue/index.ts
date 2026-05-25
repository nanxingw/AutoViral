// src/server/render-queue/index.ts

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { RenderQueueStore, defaultDbPath } from "./store.js";
import {
  RenderQueueWorker,
  type RunRenderPipelineLike,
  type WorkerProgressEvent,
} from "./worker.js";
import type { RenderJob, RenderJobOptions } from "./job.js";

export type { RenderJob, RenderJobOptions, WorkerProgressEvent };
export { defaultDbPath };

export interface RenderQueueOptions {
  /** D2 — defaults to defaultDbPath(). Use ":memory:" for tests. */
  dbPath?: string;
  runRenderPipeline: RunRenderPipelineLike;
  loadComposition: (workId: string) => Promise<any>;
  outDirFor: (workId: string) => string;
  concurrency?: number;
}

export class RenderQueue {
  private readonly db: Database.Database;
  private readonly store: RenderQueueStore;
  private readonly worker: RenderQueueWorker;
  // Phase H (#35) — in-memory side channel for runtime-only options that
  // don't belong in the persistent SQLite row (captionTracks is a UI-driven
  // ephemeral choice — not a property of the job itself). We forward it to
  // the worker via this map so the existing store schema stays untouched.
  // Entries are cleared when the worker terminates a job. Survives only
  // until process restart; that's intentional — replays after restart fall
  // back to the legacy single-track render path.
  private readonly extras = new Map<string, RenderJobOptions>();

  constructor(opts: RenderQueueOptions) {
    const path = opts.dbPath ?? defaultDbPath();
    if (path !== ":memory:") {
      try {
        mkdirSync(dirname(path), { recursive: true });
      } catch {
        /* ok */
      }
    }
    this.db = new Database(path);
    this.store = new RenderQueueStore(this.db);
    this.worker = new RenderQueueWorker({
      store: this.store,
      runRenderPipeline: opts.runRenderPipeline,
      loadComposition: opts.loadComposition,
      outDirFor: opts.outDirFor,
      concurrency: opts.concurrency,
      extrasFor: (jobId) => this.extras.get(jobId),
      clearExtras: (jobId) => this.extras.delete(jobId),
    });
    this.worker.start();
  }

  enqueue(opts: RenderJobOptions): RenderJob {
    const job = this.store.insert(opts);
    // Only remember extras when the caller actually populated runtime-only
    // fields — empty map is the cheap path for the legacy single-track UI.
    if (opts.captionTracks || opts.burnSubtitles || opts.loudnessTargetLufs) {
      this.extras.set(job.id, opts);
    }
    this.worker.notify();
    return job;
  }

  cancel(jobId: string): void {
    this.worker.cancel(jobId);
  }

  get(jobId: string): RenderJob | null {
    return this.store.get(jobId);
  }

  list(workId: string): RenderJob[] {
    return this.store.list(workId);
  }

  on(jobId: string, fn: (ev: WorkerProgressEvent) => void): () => void {
    return this.worker.on(jobId, fn);
  }

  /** Test helper / shutdown — stop the worker drain loop and close db. */
  shutdown(): void {
    this.worker.stop();
    this.db.close();
  }
}

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { RenderQueueStore } from "../store.js";
import { RenderQueueWorker } from "../worker.js";

interface StubRunner {
  fn: ReturnType<typeof vi.fn>;
  emit: (stage: string, pct: number) => void;
  resolve: (path: string) => void;
  reject: (err: Error) => void;
}

function makeStubRunner(): StubRunner {
  const captured = {
    onProgress: undefined as undefined | ((s: string, p: number) => void),
  };
  let resolveFn: (path: string) => void = () => {};
  let rejectFn: (err: Error) => void = () => {};
  const fn = vi.fn(async (opts: any) => {
    captured.onProgress = opts.onProgress;
    return new Promise<string>((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });
  });
  return {
    fn,
    emit: (stage, pct) => captured.onProgress?.(stage, pct),
    resolve: (path) => resolveFn(path),
    reject: (err) => rejectFn(err),
  };
}

let db: Database.Database;
let store: RenderQueueStore;
let runner: StubRunner;
let worker: RenderQueueWorker;

beforeEach(() => {
  db = new Database(":memory:");
  store = new RenderQueueStore(db);
  runner = makeStubRunner();
  worker = new RenderQueueWorker({
    store,
    runRenderPipeline: runner.fn as any,
    loadComposition: vi.fn(
      async (workId: string) =>
        ({
          id: "c",
          workId,
          fps: 30,
          width: 1080,
          height: 1920,
          duration: 4,
          aspect: "9:16",
          updatedAt: "x",
          tracks: [],
          assets: [],
          provenance: [],
          exportPresets: [],
        }) as any,
    ),
    outDirFor: vi.fn((workId: string) => `/tmp/works/${workId}/output`),
    concurrency: 1,
  });
});

afterEach(() => {
  worker.stop();
  db.close();
});

describe("RenderQueueWorker — lifecycle", () => {
  it("transitions queued → running → done and emits progress events", async () => {
    const job = store.insert({ workId: "w-1", type: "full" });
    const events: any[] = [];
    worker.on(job.id, (ev) => events.push(ev));
    worker.start();
    await vi.waitFor(() => expect(runner.fn).toHaveBeenCalledOnce());
    expect(store.get(job.id)?.status).toBe("running");

    runner.emit("render", 0.5);
    // R43→R46: progress is stage-aggregated with weighted budgets.
    // render owns 75% of the bar (it's the slow Chromium stage), so
    // raw 0.5 inside render → 0 + 0.5 * 0.75 = 0.375 visible.
    await vi.waitFor(() =>
      expect(
        events.some(
          (e) =>
            e.stage === "render" &&
            Math.abs(e.progress - 0.375) < 1e-6,
        ),
      ).toBe(true),
    );

    runner.resolve("/tmp/works/w-1/output/final.mp4");
    await vi.waitFor(() => expect(store.get(job.id)?.status).toBe("done"));
    expect(store.get(job.id)?.outputPath).toBe(
      "/tmp/works/w-1/output/final.mp4",
    );
    expect(events.at(-1)).toMatchObject({ status: "done", progress: 1 });
  });

  it("marks job failed and persists error message on rejection", async () => {
    const job = store.insert({ workId: "w-1", type: "full" });
    worker.start();
    await vi.waitFor(() =>
      expect(store.get(job.id)?.status).toBe("running"),
    );

    runner.reject(new Error("ffmpeg exit 137"));
    await vi.waitFor(() => expect(store.get(job.id)?.status).toBe("failed"));
    expect(store.get(job.id)?.error).toContain("ffmpeg exit 137");
  });

  it("processes jobs serially (concurrency=1)", async () => {
    const j1 = store.insert({ workId: "w-1", type: "full" });
    const j2 = store.insert({ workId: "w-2", type: "full" });
    worker.start();
    await vi.waitFor(() => expect(runner.fn).toHaveBeenCalledOnce());
    // Second job is still queued.
    expect(store.get(j2.id)?.status).toBe("queued");
    runner.resolve("/tmp/o1.mp4");
    await vi.waitFor(() => expect(store.get(j1.id)?.status).toBe("done"));
    await vi.waitFor(() => expect(runner.fn).toHaveBeenCalledTimes(2));
  });

  it("cancel() aborts in-flight render and marks job cancelled", async () => {
    const job = store.insert({ workId: "w-1", type: "full" });
    worker.start();
    await vi.waitFor(() =>
      expect(store.get(job.id)?.status).toBe("running"),
    );

    worker.cancel(job.id);
    runner.reject(new Error("aborted"));
    await vi.waitFor(() =>
      expect(store.get(job.id)?.status).toBe("cancelled"),
    );
    // The signal passed into the runner must have been aborted.
    const lastCallOpts = runner.fn.mock.calls.at(-1)![0] as any;
    expect(lastCallOpts.signal?.aborted).toBe(true);
  });

  // S11 review finding 2 — cancelling a RUNNING job must flip it to a terminal
  // status SYNCHRONOUSLY (not merely abort the controller and wait for the
  // async pipeline rejection). Otherwise there's a race window where the DELETE
  // route returns a still-"running" row and an immediately-following enqueue
  // dedups onto the job that is on its way out (findActiveRenderJob treats
  // "running" as active). We assert the flip is observable BEFORE the runner
  // settles.
  it("cancel() on a running job flips to cancelled SYNCHRONOUSLY (no await for pipeline settle)", async () => {
    const job = store.insert({ workId: "w-1", type: "full" });
    worker.start();
    await vi.waitFor(() =>
      expect(store.get(job.id)?.status).toBe("running"),
    );

    worker.cancel(job.id);
    // Immediately — WITHOUT resolving/rejecting the runner — the row must
    // already read cancelled. This closes the dedup race.
    expect(store.get(job.id)?.status).toBe("cancelled");
    // The abort still fired so the subprocess actually stops.
    const lastCallOpts = runner.fn.mock.calls.at(-1)![0] as any;
    expect(lastCallOpts.signal?.aborted).toBe(true);
    // The eventual pipeline rejection re-affirms cancelled idempotently.
    runner.reject(new Error("aborted"));
    await vi.waitFor(() =>
      expect(store.get(job.id)?.status).toBe("cancelled"),
    );
  });

  // S11 review finding 1 — the enqueued presetId must be forwarded from the job
  // row into runRenderPipeline. Pre-fix the worker never read job.presetId, so
  // `render enqueue --preset X` was a no-op at render time.
  it("forwards the job's presetId into runRenderPipeline", async () => {
    const job = store.insert({ workId: "w-1", type: "full", presetId: "bilibili-16-9" });
    worker.start();
    await vi.waitFor(() => expect(runner.fn).toHaveBeenCalledOnce());
    const opts = runner.fn.mock.calls[0]![0] as any;
    expect(opts.presetId).toBe("bilibili-16-9");
    runner.resolve("/tmp/works/w-1/output/final.mp4");
  });
});

// Legacy POST /api/works/:id/render guard tests.
//
// Phase 7.B re-shaped the contract to {jobId} (enqueue), so success-path now
// goes through RenderQueue. We keep the cheap guard cases (404 missing work,
// 409 missing composition) here; success-shape coverage lives in
// src/server/api.render.test.ts with a FakeQueue.

import { describe, it, expect, beforeEach } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { RenderJob, RenderJobOptions } from "../render-queue/index.js";

class FakeQueue {
  private rows = new Map<string, RenderJob>();
  private n = 0;
  enqueue(opts: RenderJobOptions): RenderJob {
    const id = `job_${this.n}`;
    const job: RenderJob = {
      id,
      workId: opts.workId,
      type: opts.type,
      presetId: opts.presetId,
      status: "queued",
      progress: 0,
      log: [],
      // S6 (PRD-0012) — deterministic strictly-increasing timestamps so the
      // list() ordering test doesn't depend on wall-clock resolution (two
      // enqueues within the same millisecond would otherwise tie).
      createdAt: new Date(2026, 0, 1, 0, 0, this.n).toISOString(),
    };
    this.n++;
    this.rows.set(id, job);
    return job;
  }
  get(id: string): RenderJob | null { return this.rows.get(id) ?? null; }
  cancel(id: string): void {
    const r = this.rows.get(id);
    if (r) r.status = "cancelled";
  }
  // S6 — test-only helper to move a job to a terminal state with an
  // output_path, mirroring what RenderQueueWorker does via store.update().
  markDone(id: string, outputPath: string): void {
    const r = this.rows.get(id);
    if (!r) return;
    r.status = "done";
    r.outputPath = outputPath;
    r.finishedAt = new Date(2026, 0, 1, 0, 1, this.n).toISOString();
  }
  // S6 — mirrors RenderQueueStore.list(workId): filter by work, newest first.
  list(workId: string): RenderJob[] {
    return [...this.rows.values()]
      .filter((r) => r.workId === workId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }
}

describe("POST /api/works/:id/render — legacy guards", () => {
  beforeEach(() => {
    // Each test creates its own queue; this keeps tests isolated even though
    // setRenderQueue stores a module-level singleton.
  });

  it("returns 409 if composition missing (state precondition not met)", async () => {
    // e2e-report F128: request is well-formed; missing composition.yaml is a
    // STATE conflict (not-yet-saved vs ready-to-render), not bad input. The
    // toast layer already shows the localized message via errorCode, so the
    // status code is purely a semantic signal for triage / dev tooling.
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      setRenderQueue(new FakeQueue() as any);
      const w = await createWork({
        title: "T",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/render`, {}),
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.errorCode).toBe("composition_missing");
    });
  });

  it("returns 404 if work missing", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("../api.js");
      setRenderQueue(new FakeQueue() as any);
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/nope/render`, {}),
      );
      expect(res.status).toBe(404);
    });
  });

  it("503 when RenderQueue is not yet initialized", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("../api.js");
      // Force the un-initialized state.
      setRenderQueue(null as any);
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "T",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/render`, {}),
      );
      expect(res.status).toBe(503);
    });
  });
});

// S6 (PRD-0012 / issue 027 root-cause 5) — GET /api/works/:id/render/jobs:
// list render history for a work so the UI can offer a "find my export
// again" surface after the progress modal is dismissed.
describe("GET /api/works/:id/render/jobs — export history (S6)", () => {
  it("returns only jobs for the requested work, newest first", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("../api.js");
      const queue = new FakeQueue();
      setRenderQueue(queue as any);

      const j1 = queue.enqueue({ workId: "w-1", type: "full", presetId: "douyin" });
      queue.enqueue({ workId: "w-2", type: "full" }); // other work — must not leak in
      const j3 = queue.enqueue({ workId: "w-1", type: "proxy" });

      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/works/w-1/render/jobs"),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(Array.isArray(body.jobs)).toBe(true);
      expect(body.jobs).toHaveLength(2);
      // newest first — j3 was enqueued after j1
      expect(body.jobs[0].id).toBe(j3.id);
      expect(body.jobs[1].id).toBe(j1.id);
      expect(body.jobs.every((j: any) => j.workId === "w-1")).toBe(true);
    });
  });

  it("includes output_path/preset/status/timestamps fields", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("../api.js");
      const queue = new FakeQueue();
      setRenderQueue(queue as any);
      const job = queue.enqueue({ workId: "w-1", type: "full", presetId: "douyin" });
      queue.markDone(job.id, "/Users/x/works/w-1/output/final-20260709.mp4");

      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/works/w-1/render/jobs"),
      );
      const body: any = await res.json();
      expect(body.jobs).toHaveLength(1);
      const listed = body.jobs[0];
      expect(listed).toHaveProperty(
        "outputPath",
        "/Users/x/works/w-1/output/final-20260709.mp4",
      );
      expect(listed).toHaveProperty("presetId", "douyin");
      expect(listed).toHaveProperty("status", "done");
      expect(listed).toHaveProperty("createdAt");
      expect(listed).toHaveProperty("finishedAt");
    });
  });

  it("returns an empty array (200, not 500) for a work with no render history", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("../api.js");
      setRenderQueue(new FakeQueue() as any);

      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/works/does-not-exist/render/jobs"),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.jobs).toEqual([]);
    });
  });

  it("503 when RenderQueue is not yet initialized", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("../api.js");
      setRenderQueue(null as any);
      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/works/w-1/render/jobs"),
      );
      expect(res.status).toBe(503);
    });
  });
});

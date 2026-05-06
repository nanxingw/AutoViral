// src/server/api.render.test.ts
//
// Phase 7.B Step 1: REST endpoint tests for the new render queue contract.
//   POST   /api/works/:id/render   → { jobId }            (was { ok, output })
//   GET    /api/render/jobs/:id    → RenderJob | 404
//   DELETE /api/render/jobs/:id    → cancelled RenderJob | 404
//
// We mock RenderQueue with a FakeQueue and inject via setRenderQueue. This
// keeps the test pure — no sqlite, no worker drain, no real ffmpeg.

import { describe, it, expect, beforeEach } from "vitest";
import type { RenderJob, RenderJobOptions } from "./render-queue/index.js";
import { withTempDataDir, jsonReq } from "./__tests__/_helpers.js";

class FakeQueue {
  private rows = new Map<string, RenderJob>();
  private nextId = 0;
  enqueue(opts: RenderJobOptions): RenderJob {
    const id = `job_${this.nextId++}`;
    const job: RenderJob = {
      id,
      workId: opts.workId,
      type: opts.type,
      presetId: opts.presetId,
      status: "queued",
      progress: 0,
      log: [],
      createdAt: new Date().toISOString(),
    };
    this.rows.set(id, job);
    return job;
  }
  get(id: string): RenderJob | null {
    return this.rows.get(id) ?? null;
  }
  cancel(id: string): void {
    const row = this.rows.get(id);
    if (!row) return;
    row.status = "cancelled";
  }
  list(workId: string): RenderJob[] {
    return [...this.rows.values()].filter((r) => r.workId === workId);
  }
}

describe("Phase 7.B REST endpoints", () => {
  let queue: FakeQueue;

  beforeEach(() => {
    queue = new FakeQueue();
  });

  it("POST /api/works/:id/render — enqueues and returns { jobId }", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("./api.js");
      const { createWork } = await import("../work-store.js");
      setRenderQueue(queue as any);

      const w = await createWork({
        title: "T",
        type: "short-video",
        platforms: ["douyin"],
      });
      const comp = {
        id: "c1",
        workId: w.id,
        fps: 30,
        width: 1080,
        height: 1920,
        duration: 1,
        aspect: "9:16",
        tracks: [],
        updatedAt: "2026-05-06T00:00:00Z",
      };
      const put = await apiRoutes.fetch(
        jsonReq("PUT", `/api/works/${w.id}/composition`, comp),
      );
      expect(put.status).toBe(200);

      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/render`, { type: "full" }),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(typeof body.jobId).toBe("string");
      expect(body.jobId).toMatch(/^job_/);
      // Old contract is gone — these must be absent.
      expect(body.ok).toBeUndefined();
      expect(body.output).toBeUndefined();
      const stored = queue.get(body.jobId);
      expect(stored?.type).toBe("full");
      expect(stored?.workId).toBe(w.id);
    });
  });

  it("GET /api/render/jobs/:id — returns the job row", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("./api.js");
      setRenderQueue(queue as any);

      const job = queue.enqueue({ workId: "w-1", type: "full" });
      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/render/jobs/${job.id}`),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.id).toBe(job.id);
      expect(body.workId).toBe("w-1");
      expect(body.status).toBe("queued");
    });
  });

  it("GET /api/render/jobs/:id — 404 for unknown id", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("./api.js");
      setRenderQueue(queue as any);

      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/render/jobs/job_does_not_exist"),
      );
      expect(res.status).toBe(404);
    });
  });

  it("DELETE /api/render/jobs/:id — cancels and returns the post-cancel row", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("./api.js");
      setRenderQueue(queue as any);

      const job = queue.enqueue({ workId: "w-1", type: "full" });
      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/render/jobs/${job.id}`, {
          method: "DELETE",
        }),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.status).toBe("cancelled");
      expect(body.id).toBe(job.id);
    });
  });
});

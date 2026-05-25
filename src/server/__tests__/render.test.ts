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
    const id = `job_${this.n++}`;
    const job: RenderJob = {
      id,
      workId: opts.workId,
      type: opts.type,
      status: "queued",
      progress: 0,
      log: [],
      createdAt: new Date().toISOString(),
    };
    this.rows.set(id, job);
    return job;
  }
  get(id: string): RenderJob | null { return this.rows.get(id) ?? null; }
  cancel(id: string): void {
    const r = this.rows.get(id);
    if (r) r.status = "cancelled";
  }
  list(): RenderJob[] { return [...this.rows.values()]; }
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
      const { createWork } = await import("../../work-store.js");
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
      const { createWork } = await import("../../work-store.js");
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

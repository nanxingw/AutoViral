import { describe, it, expect, beforeEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTempDataDir } from "./_helpers.js";

// #62 — POST /api/works/:id/render must dedup per work. A render is multi-minute
// and the queue has no per-work serialization, so a double-click (second POST
// before the first job leaves the queue) would enqueue a SECOND parallel render
// and orphan the first. The handler reuses the in-flight job's id instead.

type FakeJob = { id: string; status: string };

describe("findActiveRenderJob (#62)", () => {
  beforeEach(() => vi.resetModules());

  it("returns the first queued/running job for the work", async () => {
    const { findActiveRenderJob } = await import("../api.js");
    const jobs: FakeJob[] = [
      { id: "done-1", status: "done" },
      { id: "running-1", status: "running" },
      { id: "queued-1", status: "queued" },
    ];
    const queue = { list: (_w: string) => jobs as any };
    expect(findActiveRenderJob(queue as any, "w1")?.id).toBe("running-1");
  });

  it("returns null when only terminal jobs exist", async () => {
    const { findActiveRenderJob } = await import("../api.js");
    const jobs: FakeJob[] = [
      { id: "done-1", status: "done" },
      { id: "failed-1", status: "failed" },
      { id: "cancelled-1", status: "cancelled" },
    ];
    const queue = { list: (_w: string) => jobs as any };
    expect(findActiveRenderJob(queue as any, "w1")).toBeNull();
  });
});

describe("POST /api/works/:id/render dedup (#62)", () => {
  beforeEach(() => vi.resetModules());

  async function setup(activeJobs: FakeJob[]) {
    const { apiRoutes, setRenderQueue } = await import("../api.js");
    const { createWork } = await import("../../domain/work-store.js");
    const { dataDir } = await import("../../infra/config.js");

    const work = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
    // The handler fail-fasts unless composition.yaml exists on disk.
    await writeFile(join(dataDir, "works", work.id, "composition.yaml"), "id: x\n", "utf-8");

    const enqueued: unknown[] = [];
    setRenderQueue({
      list: (wid: string) => (wid === work.id ? activeJobs : []) as any,
      enqueue: (opts: unknown) => { enqueued.push(opts); return { id: "fresh-job" } as any; },
      cancel: () => {},
      get: () => null,
    } as any);

    async function post() {
      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${work.id}/render`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "full" }),
        }),
      );
      return { res, body: (await res.json()) as Record<string, any> };
    }

    return { post, enqueued, cleanup: () => setRenderQueue(null) };
  }

  it("reuses the in-flight job id instead of enqueuing a second render", async () => {
    await withTempDataDir(async () => {
      const { post, enqueued, cleanup } = await setup([{ id: "inflight-1", status: "running" }]);
      const { res, body } = await post();
      expect(res.status).toBe(200);
      expect(body).toEqual({ jobId: "inflight-1", deduped: true });
      expect(enqueued).toHaveLength(0); // NO second render spawned
      cleanup();
    });
  });

  it("enqueues a fresh job when nothing is in flight", async () => {
    await withTempDataDir(async () => {
      const { post, enqueued, cleanup } = await setup([]);
      const { res, body } = await post();
      expect(res.status).toBe(200);
      expect(body.jobId).toBe("fresh-job");
      expect(body.deduped).toBeUndefined();
      expect(enqueued).toHaveLength(1);
      cleanup();
    });
  });

  it("enqueues a fresh job when prior jobs are terminal (intentional re-export)", async () => {
    await withTempDataDir(async () => {
      const { post, enqueued, cleanup } = await setup([{ id: "old", status: "done" }]);
      const { res, body } = await post();
      expect(res.status).toBe(200);
      expect(body.jobId).toBe("fresh-job");
      expect(enqueued).toHaveLength(1);
      cleanup();
    });
  });
});

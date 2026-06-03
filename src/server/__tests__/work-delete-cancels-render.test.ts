import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir } from "./_helpers.js";

// #63 — DELETE /api/works/:id must cancel the work's in-flight render jobs
// before rm -rf'ing the directory. Otherwise the render worker keeps writing
// frames into works/<id>/output/ that storeDeleteWork is deleting → ENOENT
// crashes, wasted compute, and zombie output dirs re-created post-deletion.

type FakeJob = { id: string; workId: string; status: string };

/** Minimal RenderQueue stand-in recording which jobs got cancelled. */
function makeFakeQueue(jobs: FakeJob[]) {
  const cancelled: string[] = [];
  return {
    queue: {
      list: (workId: string) => jobs.filter((j) => j.workId === workId) as any,
      cancel: (id: string) => { cancelled.push(id); },
    },
    cancelled,
  };
}

describe("cancelInFlightRenders (#63)", () => {
  beforeEach(() => vi.resetModules());

  it("cancels only queued + running jobs, leaves terminal ones alone", async () => {
    const { cancelInFlightRenders } = await import("../api.js");
    const jobs: FakeJob[] = [
      { id: "j-queued", workId: "w1", status: "queued" },
      { id: "j-running", workId: "w1", status: "running" },
      { id: "j-done", workId: "w1", status: "done" },
      { id: "j-failed", workId: "w1", status: "failed" },
      { id: "j-cancelled", workId: "w1", status: "cancelled" },
      { id: "j-other-work", workId: "w2", status: "running" },
    ];
    const { queue, cancelled } = makeFakeQueue(jobs);
    const result = cancelInFlightRenders(queue as any, "w1");
    expect(result.sort()).toEqual(["j-queued", "j-running"]);
    expect(cancelled.sort()).toEqual(["j-queued", "j-running"]);
    // never touches another work's job
    expect(cancelled).not.toContain("j-other-work");
  });

  it("returns empty + cancels nothing when the work has no in-flight jobs", async () => {
    const { cancelInFlightRenders } = await import("../api.js");
    const { queue, cancelled } = makeFakeQueue([
      { id: "j-done", workId: "w1", status: "done" },
    ]);
    expect(cancelInFlightRenders(queue as any, "w1")).toEqual([]);
    expect(cancelled).toEqual([]);
  });
});

describe("DELETE /api/works/:id cancels in-flight renders before rm -rf (#63)", () => {
  beforeEach(() => vi.resetModules());

  it("cancels the work's running render job, then deletes the work", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("../api.js");
      const { createWork, getWork } = await import("../../domain/work-store.js");

      const work = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });

      const cancelled: string[] = [];
      // Fake queue: one running job for THIS work, one terminal job.
      setRenderQueue({
        list: (workId: string) =>
          (workId === work.id
            ? [
                { id: "r-running", status: "running" },
                { id: "r-done", status: "done" },
              ]
            : []) as any,
        cancel: (id: string) => { cancelled.push(id); },
      } as any);

      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${work.id}`, { method: "DELETE" }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: true });

      // Only the running job was cancelled (terminal one left alone).
      expect(cancelled).toEqual(["r-running"]);
      // And the work is actually gone.
      expect(await getWork(work.id)).toBeUndefined();

      setRenderQueue(null);
    });
  });

  it("deletes cleanly when no render queue is wired (renderQueue null)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setRenderQueue } = await import("../api.js");
      const { createWork, getWork } = await import("../../domain/work-store.js");
      setRenderQueue(null);
      const work = await createWork({ title: "T2", type: "short-video", platforms: ["douyin"] });
      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${work.id}`, { method: "DELETE" }),
      );
      expect(res.status).toBe(200);
      expect(await getWork(work.id)).toBeUndefined();
    });
  });
});

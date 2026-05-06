import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { RenderQueueStore } from "../store.js";
import type { RenderJob } from "../job.js";

let db: Database.Database;
let store: RenderQueueStore;

beforeEach(() => {
  db = new Database(":memory:");
  store = new RenderQueueStore(db);
});

describe("RenderQueueStore — schema + insert + read", () => {
  it("creates the render_jobs table on construction", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='render_jobs'",
      )
      .get();
    expect(row).toBeDefined();
  });

  it("insert + get round-trips a queued full job", () => {
    const job = store.insert({
      workId: "w-1",
      type: "full",
      presetId: "douyin",
    });
    expect(job.id).toMatch(/^job_/);
    expect(job.status).toBe("queued");
    expect(job.progress).toBe(0);
    expect(job.log).toEqual([]);

    const round = store.get(job.id);
    expect(round).toEqual(job);
  });

  it("list(workId) returns jobs in createdAt-desc order", () => {
    const a = store.insert({ workId: "w-1", type: "full" });
    // Sleep 2ms to make timestamps distinct deterministically
    const startWait = Date.now();
    while (Date.now() - startWait < 2) {
      /* spin */
    }
    const b = store.insert({ workId: "w-1", type: "proxy" });
    const c = store.insert({ workId: "w-2", type: "full" });
    const list = store.list("w-1");
    expect(list.map((j) => j.id)).toEqual([b.id, a.id]);
    expect(list).not.toContainEqual(expect.objectContaining({ id: c.id }));
  });

  it("update transitions status, progress, stage, and stamps startedAt/finishedAt", () => {
    const job = store.insert({ workId: "w-1", type: "full" });

    store.update(job.id, {
      status: "running",
      progress: 0.1,
      stage: "render",
    });
    let row = store.get(job.id) as RenderJob;
    expect(row.status).toBe("running");
    expect(row.progress).toBe(0.1);
    expect(row.stage).toBe("render");
    expect(row.startedAt).toBeDefined();
    expect(row.finishedAt).toBeUndefined();

    store.update(job.id, {
      status: "done",
      progress: 1,
      outputPath: "/tmp/o.mp4",
    });
    row = store.get(job.id) as RenderJob;
    expect(row.status).toBe("done");
    expect(row.outputPath).toBe("/tmp/o.mp4");
    expect(row.finishedAt).toBeDefined();
  });

  it("appendLog adds entries; persisted rows preserve log order", () => {
    const job = store.insert({ workId: "w-1", type: "full" });
    store.appendLog(job.id, {
      at: "2026-05-06T00:00:01Z",
      level: "info",
      msg: "hi",
    });
    store.appendLog(job.id, {
      at: "2026-05-06T00:00:02Z",
      level: "warn",
      msg: "watch",
    });
    const row = store.get(job.id) as RenderJob;
    expect(row.log).toEqual([
      { at: "2026-05-06T00:00:01Z", level: "info", msg: "hi" },
      { at: "2026-05-06T00:00:02Z", level: "warn", msg: "watch" },
    ]);
  });
});

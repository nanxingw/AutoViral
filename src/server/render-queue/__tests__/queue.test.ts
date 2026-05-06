import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RenderQueue } from "../index.js";

let queue: RenderQueue;
const runner = vi.fn(async () => "/tmp/out.mp4");

beforeEach(() => {
  runner.mockReset();
  runner.mockResolvedValue("/tmp/out.mp4");
  queue = new RenderQueue({
    dbPath: ":memory:",
    runRenderPipeline: runner as any,
    loadComposition: vi.fn(async (workId) => ({
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
    })),
    outDirFor: (id) => `/tmp/${id}`,
  });
});

afterEach(() => {
  queue.shutdown();
});

describe("RenderQueue — facade", () => {
  it("enqueue returns a queued job and the worker eventually runs it", async () => {
    const job = queue.enqueue({ workId: "w-1", type: "full" });
    expect(job.status).toBe("queued");
    await vi.waitFor(() => expect(queue.get(job.id)?.status).toBe("done"));
  });

  it("list returns jobs for the given workId", () => {
    queue.enqueue({ workId: "w-1", type: "full" });
    queue.enqueue({ workId: "w-2", type: "proxy" });
    expect(queue.list("w-1")).toHaveLength(1);
    expect(queue.list("w-2")).toHaveLength(1);
  });

  it("cancel on a queued job flips it to cancelled before the worker picks it up", () => {
    // Block the worker by holding the runner promise.
    let resolveFn: (v: string) => void = () => {};
    runner.mockImplementation(
      () =>
        new Promise((res) => {
          resolveFn = res;
        }),
    );
    const _j1 = queue.enqueue({ workId: "w-1", type: "full" });
    const j2 = queue.enqueue({ workId: "w-1", type: "full" });
    queue.cancel(j2.id);
    expect(queue.get(j2.id)?.status).toBe("cancelled");
    resolveFn("/tmp/x.mp4");
  });
});

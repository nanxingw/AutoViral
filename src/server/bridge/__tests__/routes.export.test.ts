// S15 (PRD-0004, US 22/23/24) — /export must actually APPLY the `preset` it
// receives. Before this slice the route accepted `body.preset` and threw it
// away, so every render fell back to the comp's exportPresets[0] (often empty)
// and the -14 LUFS default. These tests mock runRenderPipeline so we can read
// the EXACT comp + loudnessTargetLufs the route hands the pipeline — the
// render-consumption assertion that guards against the field going dead again.

import { describe, expect, it, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RenderQueue } from "../../render-queue/index.js";
import { setRenderQueue } from "../../routes/_shared.js";

// vi.mock is hoisted above imports, so the factory may not close over a
// module-scope const. vi.hoisted lifts the spy alongside it.
const { runRenderPipeline } = vi.hoisted(() => ({
  runRenderPipeline: vi.fn(async (_opts: unknown) => "/tmp/out/final-123.mp4"),
}));
vi.mock("../../render-pipeline.js", () => ({
  runRenderPipeline,
  // routes.ts also imports the `RenderStage` type; a type-only import needs
  // no runtime value, but we keep the module shape minimal + valid.
}));

import { Hono } from "hono";
import { bridgeRouter } from "../routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_WORKS_ROOT = join(__dirname, "../../../../tests/fixtures");

const app = new Hono().route("/api/bridge/v1", bridgeRouter);

type PipelineOpts = {
  comp: {
    width: number;
    height: number;
    fps: number;
    exportPresets: Array<{ id: string }>;
  };
  loudnessTargetLufs?: number;
};

function lastCall(): PipelineOpts {
  const calls = runRenderPipeline.mock.calls;
  return calls[calls.length - 1][0] as PipelineOpts;
}

describe("POST /export — platform preset really takes effect (S15)", () => {
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;
  beforeAll(() => {
    process.env.AUTOVIRAL_WORKS_ROOT = FIXTURE_WORKS_ROOT;
  });
  afterAll(() => {
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
  });
  beforeEach(() => {
    runRenderPipeline.mockClear();
  });

  it("--preset 抖音 → 9:16 + -14 LUFS reach the pipeline", async () => {
    const res = await app.request("/api/bridge/v1/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "sample-work",
      },
      body: JSON.stringify({ preset: "douyin-9-16" }),
    });
    expect(res.status).toBe(200);
    const opts = lastCall();
    expect(opts.comp.width).toBe(1080);
    expect(opts.comp.height).toBe(1920);
    expect(opts.comp.exportPresets[0].id).toBe("douyin-9-16");
    expect(opts.loudnessTargetLufs).toBe(-14);
  });

  it("--preset wechat → -16 LUFS reaches loudnorm (issue #80: NOT the -14 default)", async () => {
    const res = await app.request("/api/bridge/v1/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "sample-work",
      },
      body: JSON.stringify({ preset: "wechat-9-16" }),
    });
    expect(res.status).toBe(200);
    expect(lastCall().loudnessTargetLufs).toBe(-16);
  });

  it("preset can be named by its label too (抖音 9:16)", async () => {
    const res = await app.request("/api/bridge/v1/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "sample-work",
      },
      body: JSON.stringify({ preset: "抖音 9:16" }),
    });
    expect(res.status).toBe(200);
    expect(lastCall().comp.exportPresets[0].id).toBe("douyin-9-16");
  });

  it("unknown preset → 400 with code:4 (S3 contract — no silent swallow)", async () => {
    const res = await app.request("/api/bridge/v1/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "sample-work",
      },
      body: JSON.stringify({ preset: "totally-bogus-preset" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
    expect(body.error).toMatch(/preset/i);
    // The render must NEVER start for a rejected preset.
    expect(runRenderPipeline).not.toHaveBeenCalled();
  });

  it("no preset → falls back to the comp's own exportPresets (unchanged behaviour)", async () => {
    const res = await app.request("/api/bridge/v1/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "sample-work",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const opts = lastCall();
    // sample-work fixture has exportPresets: [] and 1080×1920 — untouched.
    expect(opts.comp.exportPresets).toHaveLength(0);
    expect(opts.loudnessTargetLufs).toBeUndefined();
  });
});

// PRD-0011 F4 — the preset↔fps decoupling trap fix. Before this slice /export
// folded `preset.fps` into the comp handed to runRenderPipeline, so exporting
// a 24fps canvas with a (30fps-recorded) platform preset silently re-encoded
// at 30fps — the render frame rate must ALWAYS follow the canvas (`comp.fps`),
// never the preset table's recorded value. Uses a dedicated temp work (fps:24)
// so the assertion is decisive even though every shipped preset happens to
// record fps:30 (mirrors the F2 route test's mkdtemp fixture pattern).
describe("POST /export — F4 preset never overrides comp.fps (canvas-owned)", () => {
  let workRoot: string;
  const workId = "w_export_fps24";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;

  beforeAll(async () => {
    const { mkdtemp, readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-export-fps-"));
    const fixtureYaml = (
      await readFile(
        join(__dirname, "../../../../tests/fixtures/sample-work/composition.yaml"),
        "utf8",
      )
    )
      .replace(/workId: sample-work/, `workId: ${workId}`)
      .replace(/^fps: 30$/m, "fps: 24");
    await mkdir(join(workRoot, workId), { recursive: true });
    await writeFile(join(workRoot, workId, "composition.yaml"), fixtureYaml, "utf8");
    process.env.AUTOVIRAL_WORKS_ROOT = workRoot;
  });
  afterAll(() => {
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
  });
  beforeEach(() => {
    runRenderPipeline.mockClear();
  });

  it("--preset douyin-9-16 (fps:30 recorded) still renders at the canvas's own fps (24)", async () => {
    const res = await app.request("/api/bridge/v1/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ preset: "douyin-9-16" }),
    });
    expect(res.status).toBe(200);
    const opts = lastCall();
    // Canvas dims + exportPresets[0] still flip to the preset...
    expect(opts.comp.width).toBe(1080);
    expect(opts.comp.height).toBe(1920);
    expect(opts.comp.exportPresets[0].id).toBe("douyin-9-16");
    // ...but fps stays the CANVAS value (24), never preset.fps (30).
    expect(opts.comp.fps).toBe(24);
  });
});

// E2E gap 2 (2026-07-09) — agent-人平权缺口. The UI's export path
// (enqueueRender → POST /api/render/jobs) inserts a row into the
// render-queue store, which is what GET /api/works/:id/render/jobs (the
// export-history menu's data source) reads. Bridge's POST /export calls
// runRenderPipeline directly and never touched that store, so an
// agent-driven export never showed up in export history. The fix records a
// terminal (done/failed) row via RenderQueue.recordExternal() after the
// pipeline call resolves/rejects — same store, same list() the UI reads.
describe("POST /export records render-queue history (E2E gap 2 — bridge/UI parity)", () => {
  let queue: InstanceType<typeof RenderQueue>;
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;

  beforeAll(() => {
    process.env.AUTOVIRAL_WORKS_ROOT = FIXTURE_WORKS_ROOT;
    queue = new RenderQueue({
      dbPath: ":memory:",
      // The worker's own runRenderPipeline must NEVER run for a bridge
      // export — bridge calls the pipeline itself, recordExternal only
      // writes the already-known result straight into the store.
      runRenderPipeline: async () => {
        throw new Error("render-queue worker path must not run for bridge /export");
      },
      loadComposition: async () => {
        throw new Error("render-queue worker path must not run for bridge /export");
      },
      outDirFor: () => "/tmp",
    });
    setRenderQueue(queue);
  });
  afterAll(() => {
    setRenderQueue(null);
    queue.shutdown();
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
  });
  beforeEach(() => {
    runRenderPipeline.mockClear();
    runRenderPipeline.mockResolvedValue("/tmp/out/final-123.mp4");
  });

  function newRows(before: Set<string>) {
    return queue.list("sample-work").filter((j) => !before.has(j.id));
  }

  it("a successful export records a done job with output_path + preset_id, findable via list()", async () => {
    const before = new Set(queue.list("sample-work").map((j) => j.id));
    const res = await app.request("/api/bridge/v1/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "sample-work",
      },
      body: JSON.stringify({ preset: "douyin-9-16" }),
    });
    expect(res.status).toBe(200);
    const added = newRows(before);
    expect(added).toHaveLength(1);
    const job = added[0]!;
    expect(job.workId).toBe("sample-work");
    expect(job.status).toBe("done");
    expect(job.outputPath).toBe("/tmp/out/final-123.mp4");
    expect(job.presetId).toBe("douyin-9-16");
    expect(job.finishedAt).toBeDefined();
  });

  it("a failed export (runRenderPipeline throws) records a failed job with the error", async () => {
    runRenderPipeline.mockRejectedValueOnce(new Error("ffmpeg exited 1"));
    const before = new Set(queue.list("sample-work").map((j) => j.id));
    const res = await app.request("/api/bridge/v1/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "sample-work",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(500);
    const added = newRows(before);
    expect(added).toHaveLength(1);
    const job = added[0]!;
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/ffmpeg exited 1/);
    expect(job.outputPath).toBeUndefined();
  });

  it("proxy export records type: proxy", async () => {
    const before = new Set(queue.list("sample-work").map((j) => j.id));
    const res = await app.request("/api/bridge/v1/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "sample-work",
      },
      body: JSON.stringify({ proxy: true }),
    });
    expect(res.status).toBe(200);
    const added = newRows(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.type).toBe("proxy");
  });

  it("when RenderQueue is unavailable (null), /export still succeeds — history recording is best-effort", async () => {
    setRenderQueue(null);
    try {
      const res = await app.request("/api/bridge/v1/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AutoViral-Work-Id": "sample-work",
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    } finally {
      setRenderQueue(queue);
    }
  });
});

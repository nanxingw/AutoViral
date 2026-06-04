// S15 (PRD-0004, US 22/23/24) — /export must actually APPLY the `preset` it
// receives. Before this slice the route accepted `body.preset` and threw it
// away, so every render fell back to the comp's exportPresets[0] (often empty)
// and the -14 LUFS default. These tests mock runRenderPipeline so we can read
// the EXACT comp + loudnessTargetLufs the route hands the pipeline — the
// render-consumption assertion that guards against the field going dead again.

import { describe, expect, it, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
  comp: { width: number; height: number; exportPresets: Array<{ id: string }> };
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

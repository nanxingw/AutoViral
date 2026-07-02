// B2 (PRD-0010) — cost-ledger route tests for the SECOND wave of instrumentation:
//   1. image generation → image AssetEntry + provenance edge + ledger row (三者齐);
//      a failed generation records nothing.
//   2. TTS (POST /api/works/:id/tts) → gemini (paid) books an estimated:true row;
//      edge-tts (free) books NOTHING (决策：免费调用不入账).
//   3. text-rewrite / translate (POST /api/works/:id/text-rewrite) → real
//      usage.cost → estimated:false; no cost → estimated:true.
//
// Mirrors cost-ledger-routes.test.ts (B1): fake providers via the registry,
// routes driven through apiRoutes.fetch, a :memory: CostLedger injected via
// setCostLedger after vi.resetModules so route + test share one module graph.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join, dirname } from "node:path";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { Composition } from "../../shared/composition.js";
import type { ImageOpts, GenerateResult } from "../../providers/base.js";

// The TTS route calls generateWithFallback (Gemini→edge). Mock it so the test
// controls which provider "wins" without spawning edge-tts or hitting OpenRouter.
// vi.hoisted so the (hoisted) vi.mock factory can read the mutable controller.
const ttsController = vi.hoisted(() => ({
  providerId: "gemini" as string,
  throws: false,
}));

vi.mock("../../providers/tts/registry.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../providers/tts/registry.js")
  >();
  return {
    ...actual,
    generateWithFallback: vi.fn(async (req: { outputPath: string }) => {
      if (ttsController.throws) throw new Error("tts boom");
      return {
        outputPath: req.outputPath,
        duration: 1.5,
        sampleRate: 24000,
        channels: 1,
        providerId: ttsController.providerId,
      };
    }),
  };
});

async function configureKey(key: string): Promise<void> {
  const { loadConfig, saveConfig } = await import("../../infra/config.js");
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, openrouter: { apiKey: key } });
}

/** Register a capturing fake as the default image provider. Must run AFTER
 *  vi.resetModules() so it lands in the registry instance api.js resolves. */
async function setupFakeImageProvider(opts?: {
  success?: boolean;
  costUsd?: number;
  estimated?: boolean;
}): Promise<ImageOpts[]> {
  const { registerProvider } = await import("../../providers/registry.js");
  const { dataDir } = await import("../../infra/config.js");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const calls: ImageOpts[] = [];
  registerProvider({
    name: "openrouter-image",
    capability: "image",
    displayName: "Fake Image",
    envKey: "OPENROUTER_API_KEY",
    default: true,
    generateImage: async (o: ImageOpts): Promise<GenerateResult> => {
      calls.push(o);
      if (opts?.success === false) {
        return { success: false, error: "provider boom", code: "API_ERROR" };
      }
      const assetPath = join(
        dataDir,
        "works",
        o.workId,
        "assets",
        "images",
        o.filename,
      );
      await mkdir(dirname(assetPath), { recursive: true });
      await writeFile(assetPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      return {
        success: true,
        assetPath,
        previewUrl: `/api/works/${o.workId}/assets/images/${o.filename}`,
        costUsd: opts?.costUsd,
        estimated: opts?.estimated,
      };
    },
  });
  return calls;
}

describe("B2 — image generation cost + provenance registration", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    ttsController.providerId = "gemini";
    ttsController.throws = false;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.unstubAllGlobals();
  });

  it("success → image AssetEntry + provenance edge + ledger row (all three)", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      await setupFakeImageProvider({ costUsd: 0.037, estimated: false });

      const w = await createWork({
        title: "img",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/image", {
          workId: w.id,
          prompt: "a hero shot",
          filename: "hero.png",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(typeof json.assetId).toBe("string");
      expect(json.assetId).toBeTruthy();

      // (1) AssetEntry + (2) provenance edge on composition.yaml
      const compPath = join(dataDir, "works", w.id, "composition.yaml");
      const comp = yaml.load(await readFile(compPath, "utf-8")) as Composition;
      const asset = (comp.assets ?? []).find((a) => a.id === json.assetId);
      expect(asset).toBeDefined();
      expect(asset?.kind).toBe("image");
      const edge = (comp.provenance ?? []).find(
        (e) => e.toAssetId === json.assetId && e.operation.type === "generate",
      );
      expect(edge).toBeDefined();
      expect(edge!.fromAssetId).toBeNull();
      expect((edge!.operation.params as any).providerId).toBe("openrouter-image");

      // (3) ledger row
      const summary = getCostLedger()!.summaryForWork(w.id);
      expect(summary.count).toBe(1);
      const image = summary.byKind.find((k) => k.kind === "image");
      expect(image).toBeDefined();
      expect(image!.usd).toBeCloseTo(0.037, 6);
      expect(image!.estimated).toBe(false);
    });
  });

  it("provider returns no cost → ledger books a flat estimate (estimated:true)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      await setupFakeImageProvider({ costUsd: undefined, estimated: undefined });

      const w = await createWork({
        title: "img2",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/image", {
          workId: w.id,
          prompt: "p",
          filename: "p.png",
        }),
      );
      expect(res.status).toBe(200);
      const summary = getCostLedger()!.summaryForWork(w.id);
      expect(summary.count).toBe(1);
      const image = summary.byKind.find((k) => k.kind === "image")!;
      expect(image.estimated).toBe(true);
      expect(image.usd).toBeGreaterThan(0);
    });
  });

  it("a FAILED image generation records nothing (no ledger, no provenance)", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      await setupFakeImageProvider({ success: false });

      const w = await createWork({
        title: "imgf",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/image", {
          workId: w.id,
          prompt: "p",
          filename: "p.png",
        }),
      );
      const json: any = await res.json();
      expect(json.success).toBe(false);

      const summary = getCostLedger()!.summaryForWork(w.id);
      expect(summary.count).toBe(0);

      // No provenance edge / asset was written either.
      const compPath = join(dataDir, "works", w.id, "composition.yaml");
      let comp: Composition | null = null;
      try {
        comp = yaml.load(await readFile(compPath, "utf-8")) as Composition;
      } catch {
        comp = null;
      }
      if (comp) {
        expect((comp.assets ?? []).length).toBe(0);
        expect((comp.provenance ?? []).length).toBe(0);
      }
    });
  });

  it("a broken ledger never breaks image generation (best-effort at the route)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger } = await import("../cost-ledger/index.js");
      const ledger = new CostLedger({ dbPath: ":memory:" });
      ledger.shutdown(); // closed db → every insert throws
      setCostLedger(ledger);
      await setupFakeImageProvider({ costUsd: 0.04, estimated: false });

      const w = await createWork({
        title: "imgok",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/image", {
          workId: w.id,
          prompt: "p",
          filename: "p.png",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(typeof json.assetId).toBe("string");
    });
  });
});

describe("B2 — TTS instrumentation (免费调用不入账)", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    ttsController.providerId = "gemini";
    ttsController.throws = false;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.unstubAllGlobals();
  });

  it("gemini (paid) TTS records an estimated:true ledger row", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      ttsController.providerId = "gemini";

      const w = await createWork({
        title: "t",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/tts`, {
          text: "你好世界，这是一段旁白",
          voice: "zh-CN-XiaoxiaoNeural",
        }),
      );
      expect(res.status).toBe(200);

      const summary = getCostLedger()!.summaryForWork(w.id);
      expect(summary.count).toBe(1);
      const tts = summary.byKind.find((k) => k.kind === "tts");
      expect(tts).toBeDefined();
      expect(tts!.estimated).toBe(true);
      expect(tts!.usd).toBeGreaterThan(0);
    });
  });

  it("edge-tts (free) TTS records NOTHING", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      ttsController.providerId = "edge-tts";

      const w = await createWork({
        title: "t2",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/tts`, {
          text: "hello narration",
          voice: "en-US-AriaNeural",
        }),
      );
      expect(res.status).toBe(200);

      const summary = getCostLedger()!.summaryForWork(w.id);
      expect(summary.count).toBe(0);
    });
  });
});

describe("B2 — text-rewrite / translate instrumentation", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.unstubAllGlobals();
  });

  function stubRewriteFetch(usage?: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "改写后的文案更有节奏" } }],
          ...(usage !== undefined ? { usage } : {}),
        }),
      })) as any,
    );
  }

  it("records a real-cost translate row (estimated:false) when usage.cost present", async () => {
    await withTempDataDir(async () => {
      await configureKey("sk-test");
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      stubRewriteFetch({ cost: 0.0012 });

      const w = await createWork({
        title: "r",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/text-rewrite`, {
          current: "原始文案",
        }),
      );
      expect(res.status).toBe(200);

      const summary = getCostLedger()!.summaryForWork(w.id);
      const t = summary.byKind.find((k) => k.kind === "translate");
      expect(t).toBeDefined();
      expect(t!.estimated).toBe(false);
      expect(t!.usd).toBeCloseTo(0.0012, 6);
    });
  });

  it("records an estimated:true translate row when the response carries no cost", async () => {
    await withTempDataDir(async () => {
      await configureKey("sk-test");
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      stubRewriteFetch(undefined);

      const w = await createWork({
        title: "r2",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/text-rewrite`, {
          current: "原始文案",
        }),
      );
      expect(res.status).toBe(200);

      const summary = getCostLedger()!.summaryForWork(w.id);
      const t = summary.byKind.find((k) => k.kind === "translate")!;
      expect(t.estimated).toBe(true);
      expect(t.usd).toBeGreaterThan(0);
    });
  });

  it("a failed rewrite (no api key) records nothing", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      // no configureKey → 503, no cost recorded

      const w = await createWork({
        title: "r3",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/text-rewrite`, {
          current: "原始文案",
        }),
      );
      expect(res.status).toBe(503);

      const summary = getCostLedger()!.summaryForWork(w.id);
      expect(summary.count).toBe(0);
    });
  });
});

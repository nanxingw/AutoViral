// B1 (PRD-0010) — cost-ledger route tests: the per-work summary endpoint plus
// the first two instrumentation paths (video real cost, BGM estimated). Mirrors
// generate-register-bootstrap.test.ts: fake providers registered via the
// registry, routes driven through apiRoutes.fetch, a fresh `:memory:` CostLedger
// injected via setCostLedger after vi.resetModules so the route + test share one
// module graph.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type {
  MusicGenerateOptions,
  MusicGenerateResult,
} from "../../providers/audio/types.js";
import type {
  VideoGenerateOptions,
  VideoGenerateResult,
} from "../../providers/video/types.js";

async function configureKey(key: string): Promise<void> {
  const { loadConfig, saveConfig } = await import("../../infra/config.js");
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, openrouter: { apiKey: key } });
}

async function setupFakeVideoProvider(opts?: {
  throws?: boolean;
  costUsd?: number;
}): Promise<VideoGenerateOptions[]> {
  const { registerProvider } = await import("../../providers/registry.js");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const calls: VideoGenerateOptions[] = [];
  registerProvider({
    name: "seedance",
    capability: "video",
    displayName: "Fake Seedance",
    envKey: "OPENROUTER_API_KEY",
    default: true,
    generateVideo: async (o: VideoGenerateOptions): Promise<VideoGenerateResult> => {
      calls.push(o);
      if (opts?.throws) throw new Error("provider boom");
      const assetUri = join(o.outputAbsoluteDir!, "clip.mp4");
      await mkdir(o.outputAbsoluteDir!, { recursive: true });
      await writeFile(assetUri, Buffer.from([0x00, 0x00, 0x00, 0x18]));
      return {
        assetUri,
        costUsd: opts?.costUsd ?? 0.5,
        stub: false,
        providerJobId: "job_1",
      };
    },
  });
  return calls;
}

async function setupFakeMusicProvider(): Promise<MusicGenerateOptions[]> {
  const { registerProvider } = await import("../../providers/registry.js");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const calls: MusicGenerateOptions[] = [];
  registerProvider({
    name: "lyria",
    capability: "music",
    displayName: "Fake Lyria",
    envKey: "OPENROUTER_API_KEY",
    default: true,
    generateMusic: async (o: MusicGenerateOptions): Promise<MusicGenerateResult> => {
      calls.push(o);
      const assetUri = join(o.outputAbsoluteDir!, o.filename);
      await mkdir(o.outputAbsoluteDir!, { recursive: true });
      await writeFile(assetUri, Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00]));
      return {
        assetUri,
        costUsd: 0.08,
        stub: false,
        audioBytes: Buffer.from([0x49, 0x44, 0x33]),
      };
    },
  });
  return calls;
}

describe("B1 cost-ledger routes — summary endpoint + video/BGM instrumentation", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("GET /api/works/:id/cost on an empty ledger returns a zero state", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { CostLedger, setCostLedger } = await import("../cost-ledger/index.js");
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));

      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/works/w-empty/cost"),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.workId).toBe("w-empty");
      expect(json.totalUsd).toBe(0);
      expect(json.count).toBe(0);
      expect(json.byKind).toEqual([]);
    });
  });

  it("video generation records ONE ledger row with the real usd (estimated:false)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      await setupFakeVideoProvider({ costUsd: 0.42 });

      const w = await createWork({
        title: "v",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "a shot",
          filename: "clip.mp4",
        }),
      );
      expect(res.status).toBe(200);

      const summary = getCostLedger()!.summaryForWork(w.id);
      expect(summary.count).toBe(1);
      expect(summary.totalUsd).toBeCloseTo(0.42, 5);
      const videoKind = summary.byKind.find((k) => k.kind === "video");
      expect(videoKind).toBeDefined();
      expect(videoKind!.estimated).toBe(false);
      expect(videoKind!.usd).toBeCloseTo(0.42, 5);
    });
  });

  it("the summary endpoint reflects the recorded video cost, scoped to the workId", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger } = await import("../cost-ledger/index.js");
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      await setupFakeVideoProvider({ costUsd: 0.42 });

      const w = await createWork({
        title: "v",
        type: "short-video",
        platforms: ["douyin"],
      });
      await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "a shot",
          filename: "clip.mp4",
        }),
      );

      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/cost`),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.workId).toBe(w.id);
      expect(json.totalUsd).toBeCloseTo(0.42, 5);
      expect(json.byKind.find((k: any) => k.kind === "video")).toBeDefined();

      // A different, unrelated work still reads a zero state.
      const otherRes = await apiRoutes.fetch(
        new Request("http://localhost/api/works/some-other-work/cost"),
      );
      const otherJson: any = await otherRes.json();
      expect(otherJson.totalUsd).toBe(0);
    });
  });

  it("BGM generation records an estimated:true ledger row", async () => {
    await withTempDataDir(async () => {
      await configureKey("sk-test");
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      await setupFakeMusicProvider();

      const w = await createWork({
        title: "b",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/bgm", {
          workId: w.id,
          prompt: "calm lofi",
        }),
      );
      expect(res.status).toBe(200);

      const summary = getCostLedger()!.summaryForWork(w.id);
      expect(summary.count).toBe(1);
      const bgm = summary.byKind.find((k) => k.kind === "bgm");
      expect(bgm).toBeDefined();
      expect(bgm!.estimated).toBe(true);
      expect(bgm!.usd).toBeCloseTo(0.08, 5);
    });
  });

  it("a FAILED video generation records nothing", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));
      await setupFakeVideoProvider({ throws: true });

      const w = await createWork({
        title: "vf",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "boom",
          filename: "clip.mp4",
        }),
      );
      expect(res.status).toBe(500);

      const summary = getCostLedger()!.summaryForWork(w.id);
      expect(summary.count).toBe(0);
    });
  });

  it("a broken ledger never breaks generation success (best-effort at the route)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger } = await import("../cost-ledger/index.js");
      // A closed db → every internal record() insert would throw. The route must
      // still return a successful generation (acceptance: 记账故障不影响生成成功率).
      const ledger = new CostLedger({ dbPath: ":memory:" });
      ledger.shutdown();
      setCostLedger(ledger);
      await setupFakeVideoProvider({ costUsd: 0.42 });

      const w = await createWork({
        title: "vok",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "a shot",
          filename: "clip.mp4",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(typeof json.assetId).toBe("string");
    });
  });
});

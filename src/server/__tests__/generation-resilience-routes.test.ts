// S10 (PRD-0014) — generation resilience at the route boundary:
//   ① request abort → the route cancels the upstream provider job. A provider
//      that CAN'T truly cancel (billed at enqueue) throws OrphanedGenerationError;
//      the route records it as an orphaned note in the cost-ledger (堵孤儿计费).
//   ② batch idempotency via generation-manifest.json: identical params → done
//      skips + returns the cached asset; a concurrent duplicate is rejected 409;
//      the upstream provider is dispatched exactly ONCE.
//
// Mirrors cost-ledger-routes.test.ts: fake providers via the registry, routes
// driven through apiRoutes.fetch, a :memory: CostLedger injected after
// vi.resetModules so route + test share one module graph. seedance is pinned to
// stub mode (no OPENROUTER_API_KEY) so nothing hits the network.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type {
  VideoGenerateOptions,
  VideoGenerateResult,
} from "../../providers/video/types.js";

function abortableReq(path: string, body: unknown, signal: AbortSignal): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

describe("S10 · generation abort → orphan bookkeeping", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("client disconnect mid-generation → provider signal fires + orphan recorded in cost-ledger", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      const { registerProvider } = await import("../../providers/registry.js");
      const { OrphanedGenerationError } = await import("../generation-resilience.js");
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));

      const cancelSpy = vi.fn();
      let sawSignal = false;
      registerProvider({
        name: "seedance",
        capability: "video",
        displayName: "Fake Seedance (abortable)",
        envKey: "OPENROUTER_API_KEY",
        default: true,
        // Hangs until the request signal aborts, then reports an orphaned
        // (billed-but-abandoned) upstream job — the seedance polling reality.
        generateVideo: (opts: VideoGenerateOptions): Promise<VideoGenerateResult> =>
          new Promise((_resolve, reject) => {
            if (opts.signal) {
              sawSignal = true;
              opts.signal.addEventListener(
                "abort",
                () => {
                  cancelSpy();
                  reject(
                    new OrphanedGenerationError({
                      providerJobId: "job_orphan_9",
                      costUsd: 0.6,
                    }),
                  );
                },
                { once: true },
              );
            }
          }),
      });

      const w = await createWork({ title: "abort", type: "short-video", platforms: ["douyin"] });

      const controller = new AbortController();
      const pending = apiRoutes.fetch(
        abortableReq("/api/generate/video", {
          workId: w.id,
          prompt: "a long push-in",
          filename: "clip.mp4",
        }, controller.signal),
      );
      // let the handler reach the provider await, then simulate the disconnect
      await new Promise((r) => setTimeout(r, 25));
      controller.abort();
      const res = await pending;

      expect(sawSignal).toBe(true);
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(res.status).toBeGreaterThanOrEqual(400);
      const json: any = await res.json();
      expect(json.orphaned).toBe(true);

      const events = getCostLedger()!.listForWork(w.id);
      const orphan = events.find((e) => e.meta && (e.meta as any).orphaned === true);
      expect(orphan).toBeDefined();
      expect((orphan!.meta as any).providerJobId).toBe("job_orphan_9");
      expect(orphan!.usd).toBeCloseTo(0.6, 5);
    });
  });

  it("a normal (un-aborted) generation completes and records NO orphan", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger, getCostLedger } = await import(
        "../cost-ledger/index.js"
      );
      const { registerProvider } = await import("../../providers/registry.js");
      const { mkdir, writeFile } = await import("node:fs/promises");
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));

      registerProvider({
        name: "seedance",
        capability: "video",
        displayName: "Fake Seedance",
        envKey: "OPENROUTER_API_KEY",
        default: true,
        generateVideo: async (o: VideoGenerateOptions): Promise<VideoGenerateResult> => {
          const assetUri = `${o.outputAbsoluteDir}/clip.mp4`;
          await mkdir(o.outputAbsoluteDir!, { recursive: true });
          await writeFile(assetUri, Buffer.from([0x00]));
          return { assetUri, costUsd: 0.42, stub: false, providerJobId: "job_ok" };
        },
      });

      const w = await createWork({ title: "ok", type: "short-video", platforms: ["douyin"] });
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "a shot",
          filename: "clip.mp4",
        }),
      );
      expect(res.status).toBe(200);

      const events = getCostLedger()!.listForWork(w.id);
      expect(events.some((e) => e.meta && (e.meta as any).orphaned)).toBe(false);
    });
  });
});

describe("S10 · generation manifest idempotency", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  async function setupCountingProvider(delayMs = 0): Promise<{ calls: () => number }> {
    const { registerProvider } = await import("../../providers/registry.js");
    const { mkdir, writeFile } = await import("node:fs/promises");
    let count = 0;
    registerProvider({
      name: "seedance",
      capability: "video",
      displayName: "Counting Seedance",
      envKey: "OPENROUTER_API_KEY",
      default: true,
      generateVideo: async (o: VideoGenerateOptions): Promise<VideoGenerateResult> => {
        count++;
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        const assetUri = `${o.outputAbsoluteDir}/clip.mp4`;
        await mkdir(o.outputAbsoluteDir!, { recursive: true });
        await writeFile(assetUri, Buffer.from([0x00]));
        return { assetUri, costUsd: 0.5, stub: false, providerJobId: "job_1" };
      },
    });
    return { calls: () => count };
  }

  it("an identical second request is SKIPPED — provider dispatched exactly once", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const provider = await setupCountingProvider();

      const w = await createWork({ title: "idem", type: "short-video", platforms: ["douyin"] });
      const body = { workId: w.id, prompt: "same prompt", filename: "clip.mp4" };

      const r1 = await apiRoutes.fetch(jsonReq("POST", "/api/generate/video", body));
      expect(r1.status).toBe(200);
      const j1: any = await r1.json();

      const r2 = await apiRoutes.fetch(jsonReq("POST", "/api/generate/video", body));
      expect(r2.status).toBe(200);
      const j2: any = await r2.json();

      expect(provider.calls()).toBe(1);
      expect(j2.skipped).toBe(true);
      // the skip echoes the first generation's asset, not a fresh dispatch
      expect(j2.assetId).toBe(j1.assetId);
    });
  });

  it("a FAILED generation clears the manifest so a retry PROCEEDS (dispatches again)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { registerProvider } = await import("../../providers/registry.js");
      const { mkdir, writeFile } = await import("node:fs/promises");

      let count = 0;
      registerProvider({
        name: "seedance",
        capability: "video",
        displayName: "Flaky Seedance",
        envKey: "OPENROUTER_API_KEY",
        default: true,
        generateVideo: async (o: VideoGenerateOptions): Promise<VideoGenerateResult> => {
          count++;
          if (count === 1) throw new Error("provider boom");
          const assetUri = `${o.outputAbsoluteDir}/clip.mp4`;
          await mkdir(o.outputAbsoluteDir!, { recursive: true });
          await writeFile(assetUri, Buffer.from([0x00]));
          return { assetUri, costUsd: 0.5, stub: false };
        },
      });

      const w = await createWork({ title: "retry", type: "short-video", platforms: ["douyin"] });
      const body = { workId: w.id, prompt: "retry me", filename: "clip.mp4" };

      const r1 = await apiRoutes.fetch(jsonReq("POST", "/api/generate/video", body));
      expect(r1.status).toBe(500);

      const r2 = await apiRoutes.fetch(jsonReq("POST", "/api/generate/video", body));
      expect(r2.status).toBe(200);
      expect(count).toBe(2);
    });
  });

  it("CONCURRENT identical requests → provider dispatched once, the duplicate is rejected 409", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const provider = await setupCountingProvider(60); // slow enough to stay in-flight

      const w = await createWork({ title: "conc", type: "short-video", platforms: ["douyin"] });
      const body = { workId: w.id, prompt: "race", filename: "clip.mp4" };

      const [a, b] = await Promise.all([
        apiRoutes.fetch(jsonReq("POST", "/api/generate/video", body)),
        apiRoutes.fetch(jsonReq("POST", "/api/generate/video", body)),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
      expect(provider.calls()).toBe(1);
    });
  });
});

// ── Review fixes (F1 / F4 / F5) ──────────────────────────────────────────────
describe("S10 review · F1 orphaned key refuses re-下单", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("after an orphaned cancel, an IDENTICAL retry is refused 409 without re-dispatching", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { CostLedger, setCostLedger } = await import("../cost-ledger/index.js");
      const { registerProvider } = await import("../../providers/registry.js");
      const { OrphanedGenerationError } = await import("../generation-resilience.js");
      setCostLedger(new CostLedger({ dbPath: ":memory:" }));

      let dispatches = 0;
      registerProvider({
        name: "seedance",
        capability: "video",
        displayName: "Orphaning Seedance",
        envKey: "OPENROUTER_API_KEY",
        default: true,
        generateVideo: (opts: VideoGenerateOptions): Promise<VideoGenerateResult> =>
          new Promise((_resolve, reject) => {
            dispatches++;
            opts.signal?.addEventListener(
              "abort",
              () => reject(new OrphanedGenerationError({ providerJobId: "job_orphan", costUsd: 0.6 })),
              { once: true },
            );
          }),
      });

      const w = await createWork({ title: "orphan-retry", type: "short-video", platforms: ["douyin"] });
      const body = { workId: w.id, prompt: "same push-in", filename: "clip.mp4" };

      const controller = new AbortController();
      const pending = apiRoutes.fetch(abortableReq("/api/generate/video", body, controller.signal));
      await new Promise((r) => setTimeout(r, 25));
      controller.abort();
      const first = await pending;
      expect((await first.json()).orphaned).toBe(true);

      // Immediate identical retry — refused WITHOUT a second (paid) dispatch.
      const second = await apiRoutes.fetch(jsonReq("POST", "/api/generate/video", body));
      expect(second.status).toBe(409);
      const j2: any = await second.json();
      expect(j2.code).toBe("GENERATION_ORPHANED");
      expect(dispatches).toBe(1);
    });
  });
});

describe("S10 review · F4 the two video endpoints don't cross-contaminate response shapes", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("provider-scoped result never leaks into the generic /api/generate/video contract", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { registerProvider } = await import("../../providers/registry.js");
      const { mkdir, writeFile } = await import("node:fs/promises");
      registerProvider({
        name: "seedance",
        capability: "video",
        displayName: "Shape Seedance",
        envKey: "OPENROUTER_API_KEY",
        default: true,
        generateVideo: async (o: VideoGenerateOptions): Promise<VideoGenerateResult> => {
          const assetUri = `${o.outputAbsoluteDir}/clip.mp4`;
          await mkdir(o.outputAbsoluteDir!, { recursive: true });
          await writeFile(assetUri, Buffer.from([0x00]));
          return { assetUri, costUsd: 0.5, stub: false, providerJobId: "job_shape" };
        },
      });

      const w = await createWork({ title: "shape", type: "short-video", platforms: ["douyin"] });

      // Provider-scoped endpoint first — its contract is { assetUri, providerJobId } (NO success).
      const r2 = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/seedance/generate-video", {
          workId: w.id,
          prompt: "identical",
          durationSec: 4,
        }),
      );
      expect(r2.status).toBe(200);
      const j2: any = await r2.json();
      expect(j2.assetUri).toBeDefined();

      // Generic endpoint, SAME generation params — must return ITS OWN contract
      // (success + previewUrl), never the provider-scoped shape via a colliding key.
      const r1 = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "identical",
          durationSec: 4,
          filename: "clip.mp4",
        }),
      );
      expect(r1.status).toBe(200);
      const j1: any = await r1.json();
      expect(j1.success).toBe(true);
      expect(j1.previewUrl).toBeDefined();
    });
  });
});

describe("S10 review · F5 key covers every content-bearing param", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("image: two requests differing ONLY in temperature both dispatch (not skipped)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { registerProvider } = await import("../../providers/registry.js");
      const { mkdir, writeFile } = await import("node:fs/promises");

      let count = 0;
      registerProvider({
        name: "openrouter-image",
        capability: "image",
        displayName: "Counting Image",
        envKey: "OPENROUTER_API_KEY",
        default: true,
        generateImage: async (o: any) => {
          count++;
          const abs = `${o.outputAbsoluteDir ?? "/tmp"}/img-${count}.png`;
          try {
            await mkdir(o.outputAbsoluteDir ?? "/tmp", { recursive: true });
            await writeFile(abs, Buffer.from([0x00]));
          } catch {
            /* ignore */
          }
          return { success: true, assetPath: abs, costUsd: 0 };
        },
      });

      const w = await createWork({ title: "temp", type: "short-video", platforms: ["douyin"] });
      const base = { workId: w.id, prompt: "a portrait", filename: "p.png" };

      const a = await apiRoutes.fetch(jsonReq("POST", "/api/generate/image", { ...base, temperature: 0.2 }));
      const b = await apiRoutes.fetch(jsonReq("POST", "/api/generate/image", { ...base, temperature: 0.9 }));
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const jb: any = await b.json();
      expect(jb.skipped).toBeUndefined();
      expect(count).toBe(2);
    });
  });
});

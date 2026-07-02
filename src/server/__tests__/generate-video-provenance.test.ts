// B7 (PRD-0010) — i2v firstFrame provenance back-link + sceneId passthrough.
// The画布's biggest data break: a video generated FROM a firstFrame image (定妆照)
// wrote a "generate" edge with fromAssetId HARDCODED null, so the canvas could
// never draw the "定妆照 → 视频" link. B7 reverse-looks-up the firstFrame input to
// the source AssetEntry id by URI match and fills fromAssetId. Reverse-lookup is
// best-effort: a data:/http(s) input (no local source asset) SILENTLY downgrades
// to fromAssetId:null and NEVER blocks generation. The generate endpoints also
// pass an optional sceneId through into the edge params (scene 归属 口子).
//
// Mirrors the capturing-fake + temp-data-dir pattern of generate-video-aspect.test.ts
// / generate-register-bootstrap.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { Composition, AssetEntry } from "../../shared/composition.js";
import type { VideoGenerateOptions } from "../../providers/video/types.js";

const COMP = (
  workId: string,
  assets: AssetEntry[] = [],
): Composition => ({
  id: `c_${workId}`,
  workId,
  fps: 30,
  width: 1080,
  height: 1920,
  duration: 0,
  aspect: "9:16",
  tracks: [],
  updatedAt: "2026-06-10T00:00:00Z",
  assets,
  provenance: assets.map((a) => ({
    fromAssetId: null,
    toAssetId: a.id,
    operation: {
      type: "upload" as const,
      actor: "user" as const,
      timestamp: "2026-06-10T00:00:00Z",
      params: {},
    },
  })),
  exportPresets: [],
});

async function writeComposition(
  dataDir: string,
  workId: string,
  assets: AssetEntry[] = [],
): Promise<void> {
  const wDir = join(dataDir, "works", workId);
  await mkdir(wDir, { recursive: true });
  await writeFile(join(wDir, "composition.yaml"), yaml.dump(COMP(workId, assets)), "utf-8");
}

/** Write a real (tiny) image file under the work's assets tree so the route's
 *  resolveFrameImage can read + base64 it (transport must still succeed). */
async function seedFrameFile(dataDir: string, workId: string, rel: string): Promise<void> {
  const abs = join(dataDir, "works", workId, "assets", rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

describe("POST /api/generate/video · B7 firstFrame provenance back-link + sceneId", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  async function setupFakeVideoProvider(): Promise<VideoGenerateOptions[]> {
    const { registerProvider } = await import("../../providers/registry.js");
    const calls: VideoGenerateOptions[] = [];
    registerProvider({
      name: "seedance",
      capability: "video",
      displayName: "Fake Seedance (capture)",
      envKey: "OPENROUTER_API_KEY",
      default: true,
      generateVideo: async (opts: VideoGenerateOptions) => {
        calls.push(opts);
        return { assetUri: `${opts.outputAbsoluteDir}/clip.mp4`, stub: true, costUsd: 0 };
      },
    });
    return calls;
  }

  function generateEdge(comp: Composition, toAssetId: string) {
    return (comp.provenance ?? []).find(
      (e) => e.toAssetId === toAssetId && e.operation.type === "generate",
    );
  }

  it("resolvable firstFrame (work-relative asset uri) → edge.fromAssetId = source image id", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      const anchor: AssetEntry = {
        id: "img_anchor",
        uri: "assets/images/anchor.png",
        kind: "image",
        metadata: {},
        status: "ready",
      };
      await writeComposition(dataDir, w.id, [anchor]);
      await seedFrameFile(dataDir, w.id, "images/anchor.png");

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "she turns to camera",
          filename: "clip.mp4",
          firstFrame: "assets/images/anchor.png",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.assetId).toBeTruthy();

      const comp = yaml.load(
        await readFile(join(dataDir, "works", w.id, "composition.yaml"), "utf-8"),
      ) as Composition;
      const edge = generateEdge(comp, json.assetId);
      expect(edge).toBeDefined();
      expect(edge!.fromAssetId).toBe("img_anchor");
    });
  });

  it("resolvable firstFrame matches an /api/works-prefixed stored uri (normalization)", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      // reframe/post-process store the /api/works/<id>/assets/... form; the caller
      // still passes the bare work-relative path. Normalization must bridge them.
      const anchor: AssetEntry = {
        id: "reframe_anchor",
        uri: `/api/works/${w.id}/assets/images/anchor.png`,
        kind: "image",
        metadata: {},
        status: "ready",
      };
      await writeComposition(dataDir, w.id, [anchor]);
      await seedFrameFile(dataDir, w.id, "images/anchor.png");

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "p",
          filename: "clip.mp4",
          firstFrame: "assets/images/anchor.png",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      const comp = yaml.load(
        await readFile(join(dataDir, "works", w.id, "composition.yaml"), "utf-8"),
      ) as Composition;
      expect(generateEdge(comp, json.assetId)!.fromAssetId).toBe("reframe_anchor");
    });
  });

  it("data-URI firstFrame → fromAssetId null AND generation still succeeds", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, []);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "p",
          filename: "clip.mp4",
          firstFrame: "data:image/png;base64,iVBORw0KGgo=",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.assetId).toBeTruthy();
      const comp = yaml.load(
        await readFile(join(dataDir, "works", w.id, "composition.yaml"), "utf-8"),
      ) as Composition;
      expect(generateEdge(comp, json.assetId)!.fromAssetId).toBeNull();
    });
  });

  it("external http(s) firstFrame → fromAssetId null AND generation still succeeds", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, []);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "p",
          filename: "clip.mp4",
          firstFrame: "https://example.com/anchor.png",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.assetId).toBeTruthy();
      const comp = yaml.load(
        await readFile(join(dataDir, "works", w.id, "composition.yaml"), "utf-8"),
      ) as Composition;
      expect(generateEdge(comp, json.assetId)!.fromAssetId).toBeNull();
    });
  });

  it("sceneId passthrough → edge params carry sceneId, asset+edge written atomically (ADR-012)", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, []);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "p",
          filename: "clip.mp4",
          sceneId: "sc_hero",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.assetId).toBeTruthy();

      const comp = yaml.load(
        await readFile(join(dataDir, "works", w.id, "composition.yaml"), "utf-8"),
      ) as Composition;
      // Atomicity: the asset AND its generate edge co-exist (single write).
      expect((comp.assets ?? []).some((a) => a.id === json.assetId)).toBe(true);
      const edge = generateEdge(comp, json.assetId);
      expect(edge).toBeDefined();
      expect((edge!.operation.params as any).sceneId).toBe("sc_hero");
    });
  });

  it("no sceneId → edge params carry NO sceneId key (口子 is opt-in)", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      await writeComposition(dataDir, w.id, []);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "p",
          filename: "clip.mp4",
        }),
      );
      const json: any = await res.json();
      const comp = yaml.load(
        await readFile(join(dataDir, "works", w.id, "composition.yaml"), "utf-8"),
      ) as Composition;
      const params = generateEdge(comp, json.assetId)!.operation.params as any;
      expect("sceneId" in params).toBe(false);
    });
  });
});

// B7 review fix — the UI (GenerationDialog) drives the i2v anchor through
// /api/providers/:id/generate-video, and absolutizeWorkspaceUri turns the local
// asset uri into a SAME-ORIGIN absolute URL (http://<origin>/api/works/<id>/
// assets/...) so OpenRouter's server-side fetch can reach it. Before the fix,
// findSourceAssetIdByFrame short-circuited on ANY http(s) input → fromAssetId
// null → the画布 never drew the 定妆照 → 视频 link for the PRIMARY human path. The
// discriminator is the /api/works/<id>/ path segment: a same-origin workspace
// URL resolves; a TRULY external host still stays null (no forged links).
describe("B7 review · same-origin workspace http firstFrame resolves the back-link", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  async function setupFakeVideoProvider(): Promise<VideoGenerateOptions[]> {
    const { registerProvider } = await import("../../providers/registry.js");
    const calls: VideoGenerateOptions[] = [];
    registerProvider({
      name: "seedance",
      capability: "video",
      displayName: "Fake Seedance (capture)",
      envKey: "OPENROUTER_API_KEY",
      default: true,
      generateVideo: async (opts: VideoGenerateOptions) => {
        calls.push(opts);
        return { assetUri: `${opts.outputAbsoluteDir}/clip.mp4`, stub: true, costUsd: 0 };
      },
    });
    return calls;
  }

  function generateEdge(comp: Composition, toAssetId: string) {
    return (comp.provenance ?? []).find(
      (e) => e.toAssetId === toAssetId && e.operation.type === "generate",
    );
  }

  it("UI path (/api/providers/:id/generate-video) same-origin workspace firstFrameImage → edge.fromAssetId = source image id", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      const anchor: AssetEntry = {
        id: "img_anchor",
        uri: "assets/images/anchor.png",
        kind: "image",
        metadata: {},
        status: "ready",
      };
      await writeComposition(dataDir, w.id, [anchor]);

      // Exactly what GenerationDialog sends: absolutizeWorkspaceUri(source.uri)
      // = <origin>/api/works/<id>/assets/images/anchor.png.
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/seedance/generate-video", {
          workId: w.id,
          prompt: "she turns to camera",
          firstFrameImage: `http://localhost:3271/api/works/${w.id}/assets/images/anchor.png`,
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.assetId).toBeTruthy();

      const comp = yaml.load(
        await readFile(join(dataDir, "works", w.id, "composition.yaml"), "utf-8"),
      ) as Composition;
      expect(generateEdge(comp, json.assetId)!.fromAssetId).toBe("img_anchor");
    });
  });

  it("UI path — truly external host firstFrameImage → fromAssetId null (no forged link)", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      // An external CDN URL whose PATH happens to collide with a stored asset uri
      // must NOT be linked — only /api/works/<id>/ same-origin URLs resolve.
      const anchor: AssetEntry = {
        id: "img_anchor",
        uri: "assets/images/anchor.png",
        kind: "image",
        metadata: {},
        status: "ready",
      };
      await writeComposition(dataDir, w.id, [anchor]);

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/providers/seedance/generate-video", {
          workId: w.id,
          prompt: "p",
          firstFrameImage: "https://cdn.example.com/assets/images/anchor.png",
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.assetId).toBeTruthy();
      const comp = yaml.load(
        await readFile(join(dataDir, "works", w.id, "composition.yaml"), "utf-8"),
      ) as Composition;
      expect(generateEdge(comp, json.assetId)!.fromAssetId).toBeNull();
    });
  });

  it("agent path (/api/generate/video) also resolves a same-origin workspace http firstFrame", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      await setupFakeVideoProvider();

      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });
      const anchor: AssetEntry = {
        id: "img_anchor",
        uri: `/api/works/${w.id}/assets/images/anchor.png`,
        kind: "image",
        metadata: {},
        status: "ready",
      };
      await writeComposition(dataDir, w.id, [anchor]);
      await seedFrameFile(dataDir, w.id, "images/anchor.png");

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/video", {
          workId: w.id,
          prompt: "p",
          filename: "clip.mp4",
          firstFrame: `http://localhost:3271/api/works/${w.id}/assets/images/anchor.png`,
        }),
      );
      expect(res.status).toBe(200);
      const json: any = await res.json();
      const comp = yaml.load(
        await readFile(join(dataDir, "works", w.id, "composition.yaml"), "utf-8"),
      ) as Composition;
      expect(generateEdge(comp, json.assetId)!.fromAssetId).toBe("img_anchor");
    });
  });
});

// POST /api/works/:id/composition/gc-orphans
//
// Garbage-collects AssetEntries whose physical files no longer exist on
// disk (post-ad67b9b stale gen_* entries), removes timeline clips that
// referenced those files, and prunes orphan provenance edges so the dive
// view doesn't blow up on missing toAssetId targets.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { Composition } from "../../shared/composition.js";

beforeEach(() => {
  vi.resetModules();
});

function makeComp(workId: string, overrides: Partial<Composition> = {}): Composition {
  return {
    id: `c_${workId}`,
    workId,
    fps: 30,
    width: 1080,
    height: 1920,
    duration: 5,
    aspect: "9:16",
    tracks: [
      {
        id: "video-0",
        kind: "video",
        label: "Video",
        muted: false,
        hidden: false,
        volume: 0,
        displayOrder: 0,
      transitions: [],
        clips: [],
      },
    ],
    updatedAt: "2026-05-06T00:00:00Z",
    assets: [],
    provenance: [],
    exportPresets: [],
    ...overrides,
  };
}

async function setupWork(
  dataDir: string,
  comp: Composition,
  files: Array<{ rel: string; bytes?: string }>,
): Promise<void> {
  const wDir = join(dataDir, "works", comp.workId);
  await mkdir(wDir, { recursive: true });
  for (const f of files) {
    const abs = join(wDir, f.rel);
    const dir = abs.split("/").slice(0, -1).join("/");
    await mkdir(dir, { recursive: true });
    await writeFile(abs, f.bytes ?? "fake-bytes");
  }
  await writeFile(
    join(wDir, "composition.yaml"),
    yaml.dump(comp, { lineWidth: -1 }),
    "utf-8",
  );
}

describe("POST /api/works/:id/composition/gc-orphans", () => {
  it("returns 0/0/[] when nothing is missing", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "GC: no orphans",
        type: "short-video",
        platforms: ["douyin"],
      });
      const comp = makeComp(w.id, {
        assets: [
          {
            id: "vid1",
            uri: "clips/intro.mp4",
            kind: "video",
            metadata: {},
            status: "ready",
          },
        ],
      });
      await setupWork(dataDir, comp, [
        { rel: "assets/clips/intro.mp4" },
      ]);

      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/composition/gc-orphans`),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.removed).toBe(0);
      expect(body.marked).toBe(0);
      expect(body.orphans).toEqual([]);
    });
  });

  it("marks status='failed' on a missing video asset and lists it in orphans", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "GC: missing video",
        type: "short-video",
        platforms: ["douyin"],
      });
      const comp = makeComp(w.id, {
        assets: [
          {
            id: "gen_deadbeef",
            uri: "clips/missing.mp4",
            kind: "video",
            metadata: {},
            status: "ready",
          },
        ],
      });
      // intentionally do NOT create the file
      await setupWork(dataDir, comp, []);

      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/composition/gc-orphans`),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.orphans).toEqual(["gen_deadbeef"]);
      expect(body.marked).toBe(1);
      expect(body.removed).toBe(0);

      const persisted = yaml.load(
        await readFile(
          join(dataDir, "works", w.id, "composition.yaml"),
          "utf-8",
        ),
      ) as Composition;
      expect(persisted.assets[0].status).toBe("failed");
    });
  });

  it("removes a timeline clip that referenced an orphan asset", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "GC: clip removed",
        type: "short-video",
        platforms: ["douyin"],
      });
      const comp = makeComp(w.id, {
        assets: [
          {
            id: "gen_a",
            uri: "clips/missing.mp4",
            kind: "video",
            metadata: {},
            status: "ready",
          },
        ],
        tracks: [
          {
            id: "video-0",
            kind: "video",
            label: "Video",
            muted: false,
            hidden: false,
            volume: 0,
            displayOrder: 0,
      transitions: [],
            clips: [
              {
                id: "vc_0",
                kind: "video",
                src: `/api/works/${w.id}/assets/clips/missing.mp4`,
                in: 0,
                out: 3,
                trackOffset: 0,
                transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
                filters: { brightness: 0, contrast: 0, saturation: 0 },
              },
            ],
          },
        ],
      });
      await setupWork(dataDir, comp, []);

      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/composition/gc-orphans`),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.orphans).toEqual(["gen_a"]);
      expect(body.removed).toBe(1);
      expect(body.marked).toBe(1);

      const persisted = yaml.load(
        await readFile(
          join(dataDir, "works", w.id, "composition.yaml"),
          "utf-8",
        ),
      ) as Composition;
      expect(persisted.tracks[0].clips).toHaveLength(0);
      expect(persisted.assets[0].status).toBe("failed");
    });
  });

  it("removes provenance edges that point at a removed-orphan asset id", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "GC: provenance pruned",
        type: "short-video",
        platforms: ["douyin"],
      });
      const comp = makeComp(w.id, {
        assets: [
          {
            id: "gen_orphan",
            uri: "clips/missing.mp4",
            kind: "video",
            metadata: {},
            status: "ready",
          },
          {
            id: "vid_live",
            uri: "clips/intro.mp4",
            kind: "video",
            metadata: {},
            status: "ready",
          },
        ],
        provenance: [
          {
            fromAssetId: null,
            toAssetId: "gen_orphan",
            operation: {
              type: "generate",
              actor: "user",
              timestamp: "2026-05-06T00:00:00Z",
              params: {},
            },
          },
          {
            fromAssetId: null,
            toAssetId: "vid_live",
            operation: {
              type: "upload",
              actor: "user",
              timestamp: "2026-05-06T00:00:00Z",
              params: {},
            },
          },
        ],
      });
      await setupWork(dataDir, comp, [
        { rel: "assets/clips/intro.mp4" },
      ]);

      const res = await apiRoutes.fetch(
        jsonReq("POST", `/api/works/${w.id}/composition/gc-orphans`),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.orphans).toEqual(["gen_orphan"]);

      const persisted = yaml.load(
        await readFile(
          join(dataDir, "works", w.id, "composition.yaml"),
          "utf-8",
        ),
      ) as Composition;
      expect(persisted.provenance).toHaveLength(1);
      expect(persisted.provenance[0].toAssetId).toBe("vid_live");
    });
  });
});

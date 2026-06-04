// I18 (PRD-0003 §3.2) — DELETE /api/works/:id/assets/* removes an on-disk
// asset file. Mirrors the shared-assets delete contract: SAFE_ID-guarded
// workId + traversal-rejecting path resolution + 404 on a missing file.
//
// The happy path writes a real file into a temp dataDir, deletes it via the
// endpoint, and asserts the file is gone from disk (user-visible "disk + UI
// both clear" — the UI half lives in the web test).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { withTempDataDir } from "./_helpers.js";

beforeEach(() => {
  vi.resetModules();
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("DELETE /api/works/:id/assets/* — happy path", () => {
  it("deletes the on-disk file and returns deleted:true", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "delete me",
        type: "short-video",
        platforms: ["douyin"],
      });
      const wDir = join(dataDir, "works", w.id);
      const filePath = join(wDir, "assets", "clips", "gone.mp4");
      await mkdir(join(wDir, "assets", "clips"), { recursive: true });
      await writeFile(filePath, "fake-bytes");
      expect(await fileExists(filePath)).toBe(true);

      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/assets/clips/gone.mp4`, {
          method: "DELETE",
        }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { deleted?: boolean };
      expect(json.deleted).toBe(true);

      // The user-visible promise: the file is actually gone from disk.
      expect(await fileExists(filePath)).toBe(false);
    });
  });

  it("also removes a sibling .peaks.json so no stale waveform remains", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "audio",
        type: "short-video",
        platforms: ["douyin"],
      });
      const wDir = join(dataDir, "works", w.id);
      const audioPath = join(wDir, "assets", "audio", "vo.mp3");
      await mkdir(join(wDir, "assets", "audio"), { recursive: true });
      await writeFile(audioPath, "fake-mp3");
      await writeFile(`${audioPath}.peaks.json`, "[0,1,0]");

      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/assets/audio/vo.mp3`, {
          method: "DELETE",
        }),
      );
      expect(res.status).toBe(200);
      expect(await fileExists(audioPath)).toBe(false);
      expect(await fileExists(`${audioPath}.peaks.json`)).toBe(false);
    });
  });

  it("deletes via the doubled-`assets/` URL the frontend actually sends", async () => {
    // queries/assets.ts builds the URL as /api/works/<id>/assets/ + the
    // work-relative path "assets/clips/x.mp4", producing a doubled prefix. The
    // serve route normalises it; the delete route must agree so a listed asset
    // is always deletable.
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "doubled",
        type: "short-video",
        platforms: ["douyin"],
      });
      const wDir = join(dataDir, "works", w.id);
      const filePath = join(wDir, "assets", "clips", "dbl.mp4");
      await mkdir(join(wDir, "assets", "clips"), { recursive: true });
      await writeFile(filePath, "fake-bytes");

      const res = await apiRoutes.fetch(
        new Request(
          `http://localhost/api/works/${w.id}/assets/assets/clips/dbl.mp4`,
          { method: "DELETE" },
        ),
      );
      expect(res.status).toBe(200);
      expect(await fileExists(filePath)).toBe(false);
    });
  });

  it("deletes a file under the output/ root too", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "out",
        type: "short-video",
        platforms: ["douyin"],
      });
      const wDir = join(dataDir, "works", w.id);
      const outPath = join(wDir, "output", "final.mp4");
      await mkdir(join(wDir, "output"), { recursive: true });
      await writeFile(outPath, "rendered");

      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/assets/output/final.mp4`, {
          method: "DELETE",
        }),
      );
      expect(res.status).toBe(200);
      expect(await fileExists(outPath)).toBe(false);
    });
  });
});

describe("DELETE /api/works/:id/assets/* — guards", () => {
  it("404s when the file does not exist", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "missing",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/assets/clips/nope.mp4`, {
          method: "DELETE",
        }),
      );
      expect(res.status).toBe(404);
      const json = (await res.json()) as { errorCode?: string };
      expect(json.errorCode).toBe("asset_not_found");
    });
  });

  it("400 rejects a workId that fails SAFE_ID before touching the filesystem", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/evil.id/assets/clips/a.mp4`, {
          method: "DELETE",
        }),
      );
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error?: string };
      expect(json.error).toMatch(/workId|Invalid/i);
    });
  });

  it("400 rejects a path-traversal nested path (escapes the asset root)", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "traverse",
        type: "short-video",
        platforms: ["douyin"],
      });
      // Plant a secret OUTSIDE the asset root that a traversal would target.
      const secret = join(dataDir, "works", w.id, "work.yaml");
      await writeFile(secret, "id: secret");

      // ../../work.yaml from assets/ would reach the work dir if unguarded.
      const res = await apiRoutes.fetch(
        new Request(
          `http://localhost/api/works/${w.id}/assets/${encodeURIComponent("../../work.yaml")}`,
          { method: "DELETE" },
        ),
      );
      expect(res.status).toBe(400);
      // The guarded secret must still be on disk.
      expect(await fileExists(secret)).toBe(true);
    });
  });
});

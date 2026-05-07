// Phase 5+ — regression tests for GET /api/works/:id/assets/* path resolution.
//
// Existing AssetEntry.uri values vary in shape: some are work-relative
// ("clips/foo.mp4") while others (notably from the legacy synthesiser and
// older flows) include the leading "assets/" segment. Frontend builds the
// URL via `/api/works/${id}/assets/${uri}`, which produces the doubled form
// `/api/works/:id/assets/assets/clips/foo.mp4`. The server route handler
// MUST normalise the doubled prefix back to a single asset root lookup,
// otherwise every legacy asset 404s.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTempDataDir } from "./_helpers.js";

beforeEach(() => {
  vi.resetModules();
});

describe("GET /api/works/:id/assets/* — path normalisation", () => {
  it("serves a file under assets/clips/ via the canonical single-prefix URL", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "Asset URL test (single)",
        type: "short-video",
        platforms: ["douyin"],
      });
      const wDir = join(dataDir, "works", w.id);
      await mkdir(join(wDir, "assets", "clips"), { recursive: true });
      await writeFile(join(wDir, "assets", "clips", "foo.mp4"), "fake-bytes");

      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/assets/clips/foo.mp4`),
      );
      expect(res.status).toBe(200);
      const buf = await res.arrayBuffer();
      expect(new TextDecoder().decode(buf)).toBe("fake-bytes");
    });
  });

  it("serves the same file via the doubled-`assets/` URL (frontend bug shape)", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({
        title: "Asset URL test (doubled)",
        type: "short-video",
        platforms: ["douyin"],
      });
      const wDir = join(dataDir, "works", w.id);
      await mkdir(join(wDir, "assets", "clips"), { recursive: true });
      await writeFile(join(wDir, "assets", "clips", "foo.mp4"), "fake-bytes");

      const res = await apiRoutes.fetch(
        new Request(
          `http://localhost/api/works/${w.id}/assets/assets/clips/foo.mp4`,
        ),
      );
      expect(res.status).toBe(200);
      const buf = await res.arrayBuffer();
      expect(new TextDecoder().decode(buf)).toBe("fake-bytes");
    });
  });
});

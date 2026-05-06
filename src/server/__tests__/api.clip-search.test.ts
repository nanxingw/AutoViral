// src/server/__tests__/api.clip-search.test.ts
//
// Phase 8.1.B — route handler tests for the three CLIP-search endpoints:
//   POST /api/clip-index/build
//   GET  /api/clip-index/status
//   GET  /api/works/:id/assets/search
//
// Each test mocks the bridge module so no Python is actually spawned.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

vi.mock("../clip-index.js", () => ({
  buildClipIndex: vi.fn(),
  searchClipIndex: vi.fn(),
  getClipIndexStatus: vi.fn(),
  clipIndexDir: vi.fn(() => "/tmp/dummy"),
}));

import { buildClipIndex, searchClipIndex, getClipIndexStatus } from "../clip-index.js";

const _build = buildClipIndex as unknown as ReturnType<typeof vi.fn>;
const _search = searchClipIndex as unknown as ReturnType<typeof vi.fn>;
const _status = getClipIndexStatus as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  _build.mockReset();
  _search.mockReset();
  _status.mockReset();
  vi.resetModules();
});

describe("POST /api/clip-index/build", () => {
  it("returns build result on happy path", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      _build.mockResolvedValueOnce({
        ok: true, stub: false, assetCount: 5, model: "ViT-B-32",
        indexedAt: "2026-05-06T00:00:00Z", durationMs: 1234,
      });
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/clip-index/build", { workId: "work-abc" }),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.ok).toBe(true);
      expect(body.assetCount).toBe(5);
      expect(_build).toHaveBeenCalledWith("work-abc");
    });
  });

  it("propagates stub body verbatim when bridge stubs", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      _build.mockResolvedValueOnce({ stub: true, reason: "open_clip_torch not installed" });
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/clip-index/build", { workId: "work-abc" }),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.stub).toBe(true);
      expect(body.reason).toMatch(/open_clip/);
    });
  });

  it("rejects an unsafe workId with 400", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/clip-index/build", { workId: "../etc" }),
      );
      expect(res.status).toBe(400);
      expect(_build).not.toHaveBeenCalled();
    });
  });
});

describe("GET /api/clip-index/status", () => {
  it("returns status from bridge", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      _status.mockResolvedValueOnce({
        stub: false, model: "ViT-B-32", assetCount: 3,
        indexedAt: "2026-05-06T00:00:00Z",
      });
      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/clip-index/status?workId=work-abc"),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.assetCount).toBe(3);
    });
  });

  it("returns stub no_index when bridge reports no index", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      _status.mockResolvedValueOnce({ stub: true, reason: "no_index" });
      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/clip-index/status?workId=work-abc"),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.stub).toBe(true);
      expect(body.reason).toBe("no_index");
    });
  });
});

describe("GET /api/works/:id/assets/search", () => {
  it("returns 400 when q is missing or empty", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/works/work-abc/assets/search?q="),
      );
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toMatch(/q/);
      expect(_search).not.toHaveBeenCalled();
    });
  });

  it("returns ranked results from bridge", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      _search.mockResolvedValueOnce({
        stub: false,
        results: [
          { uri: "assets/images/panda.png", kind: "image", score: 0.42 },
        ],
        searchMs: 87,
      });
      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/works/work-abc/assets/search?q=panda&topK=5"),
      );
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].score).toBeCloseTo(0.42);
      expect(_search).toHaveBeenCalledWith("work-abc", "panda", 5);
    });
  });

  it("clamps topK to [1,100] and defaults to 20", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      _search.mockResolvedValue({ stub: false, results: [], searchMs: 1 });

      await apiRoutes.fetch(
        new Request("http://localhost/api/works/work-abc/assets/search?q=panda"),
      );
      expect(_search).toHaveBeenLastCalledWith("work-abc", "panda", 20);

      await apiRoutes.fetch(
        new Request("http://localhost/api/works/work-abc/assets/search?q=panda&topK=999"),
      );
      expect(_search).toHaveBeenLastCalledWith("work-abc", "panda", 100);

      await apiRoutes.fetch(
        new Request("http://localhost/api/works/work-abc/assets/search?q=panda&topK=0"),
      );
      expect(_search).toHaveBeenLastCalledWith("work-abc", "panda", 1);
    });
  });

  it("rejects unsafe workId", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        new Request("http://localhost/api/works/..bad/assets/search?q=x"),
      );
      expect(res.status).toBe(400);
      expect(_search).not.toHaveBeenCalled();
    });
  });
});

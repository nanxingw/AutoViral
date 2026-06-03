import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir } from "./_helpers.js";

// #67 — both upload endpoints must reject oversized uploads. The decisive guard
// is uploadBodyLimit: it checks Content-Length and rejects BEFORE parseBody
// buffers the body into heap (a file.size check alone runs too late — the OOM
// spike already happened). These tests drive the Content-Length path, which is
// the normal browser-upload case, without allocating a real 100MB+ body.

function oversizedRequest(path: string) {
  // Content-Length far over the cap; tiny actual body. bodyLimit rejects on the
  // header before reading, so the body is never buffered.
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-length": String(101 * 1024 * 1024) },
    body: "x",
  });
}

describe("upload size cap (#67)", () => {
  beforeEach(() => vi.resetModules());

  it("MAX_UPLOAD_BYTES is the shared 100MB constant", async () => {
    const { MAX_UPLOAD_BYTES } = await import("../api.js");
    expect(MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
  });

  it("rejects an oversized work-asset upload with 413 + asset_too_large (before buffering)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const work = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      const res = await apiRoutes.fetch(oversizedRequest(`/api/works/${work.id}/assets/upload`));
      expect(res.status).toBe(413);
      expect((await res.json()).errorCode).toBe("asset_too_large");
    });
  });

  it("rejects an oversized shared-asset upload with 413 + asset_too_large", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(oversizedRequest(`/api/shared-assets/music`));
      expect(res.status).toBe(413);
      expect((await res.json()).errorCode).toBe("asset_too_large");
    });
  });

  it("does NOT reject a normally-sized work-asset upload (middleware passes valid bodies through)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const work = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      const fd = new FormData();
      fd.append("file", new File(["fake-png-bytes"], "pic.png", { type: "image/png" }));
      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${work.id}/assets/upload`, { method: "POST", body: fd }),
      );
      // 200 (uploaded) — the point is it's NOT a 413; the small body sails past
      // bodyLimit's streaming counter and the in-handler size guard.
      expect(res.status).toBe(200);
    });
  });
});

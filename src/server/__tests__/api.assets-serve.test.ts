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
import type { Hono } from "hono";
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
      const { createWork } = await import("../../domain/work-store.js");
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
      const { createWork } = await import("../../domain/work-store.js");
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

// #52 — stored-XSS hardening for served assets. An uploaded SVG with an inline
// <script> executed in the app's own origin when its URL was navigated to,
// because the serve endpoint set Content-Type: image/svg+xml with no
// anti-execution headers and the upload endpoint had no type allowlist.
const XSS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><script>document.title="XSSPROBE-EXECUTED"</script></svg>';

describe("GET /api/works/:id/assets/* — security headers (#52)", () => {
  it("serves SVG with nosniff + a script-blocking CSP sandbox", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({ title: "svg", type: "image-text", platforms: ["douyin"] });
      const wDir = join(dataDir, "works", w.id);
      await mkdir(join(wDir, "assets", "images"), { recursive: true });
      await writeFile(join(wDir, "assets", "images", "x.svg"), XSS_SVG);

      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/assets/images/x.svg`),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("sandbox");
      expect(csp).toContain("default-src 'none'");
    });
  });

  it("adds nosniff but NOT a CSP to a normal image (CSP is SVG-only)", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({ title: "png", type: "image-text", platforms: ["douyin"] });
      const wDir = join(dataDir, "works", w.id);
      await mkdir(join(wDir, "assets", "images"), { recursive: true });
      await writeFile(join(wDir, "assets", "images", "ok.png"), "fake-png");

      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/assets/images/ok.png`),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toBeNull();
    });
  });
});

describe("POST /api/works/:id/assets/upload — type allowlist (#52)", () => {
  async function uploadFile(apiRoutes: Hono, workId: string, name: string, type: string, body: string) {
    const fd = new FormData();
    fd.append("file", new File([body], name, { type }), name);
    fd.append("subdir", "images");
    return apiRoutes.fetch(
      new Request(`http://localhost/api/works/${workId}/assets/upload`, { method: "POST", body: fd }),
    );
  }

  it("rejects a non-media extension (e.g. .html) with 415 + errorCode", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({ title: "up", type: "image-text", platforms: ["douyin"] });
      void dataDir;
      const res = await uploadFile(apiRoutes, w.id, "evil.html", "text/html", "<script>1</script>");
      expect(res.status).toBe(415);
      const json = (await res.json()) as { errorCode?: string };
      expect(json.errorCode).toBe("unsupported_asset_type");
    });
  });

  it("accepts a png upload (allowlisted)", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({ title: "up2", type: "image-text", platforms: ["douyin"] });
      void dataDir;
      const res = await uploadFile(apiRoutes, w.id, "pic.png", "image/png", "fake-png-bytes");
      expect(res.status).toBe(200);
      const json = (await res.json()) as { success?: boolean };
      expect(json.success).toBe(true);
    });
  });

  it("end-to-end: an uploaded SVG is served back with the script-blocking CSP", async () => {
    await withTempDataDir(async (dataDir) => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({ title: "e2e", type: "image-text", platforms: ["douyin"] });
      void dataDir;
      const up = await uploadFile(apiRoutes, w.id, "probe.svg", "image/svg+xml", XSS_SVG);
      expect(up.status).toBe(200); // SVG is allowed in, but neutralised on the way out
      const { url } = (await up.json()) as { url: string };
      const got = await apiRoutes.fetch(new Request(`http://localhost${url}`));
      expect(got.status).toBe(200);
      expect(got.headers.get("content-security-policy") ?? "").toContain("sandbox");
      expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    });
  });
});

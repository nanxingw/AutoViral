import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir } from "./_helpers.js";

describe("GET /api/works/:id/rubric/:module — read-only rubric tool", () => {
  beforeEach(() => vi.resetModules());

  it("returns rubric markdown for a known module", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      setWsBridge({ getSession: vi.fn(), createSession: vi.fn(), sendMessage: vi.fn() } as any);
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      const res = await apiRoutes.fetch(new Request(`http://localhost/api/works/${w.id}/rubric/research`));
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(j.module).toBe("research");
      expect(typeof j.rubric).toBe("string");
      expect(j.rubric.length).toBeGreaterThan(50);  // taste/06-rubric.md is non-trivial
    });
  });

  it("returns 404 for unknown module", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes, setWsBridge } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      setWsBridge({ getSession: vi.fn(), createSession: vi.fn(), sendMessage: vi.fn() } as any);
      const w = await createWork({ title: "T", type: "image-text", platforms: ["xiaohongshu"] });
      const res = await apiRoutes.fetch(new Request(`http://localhost/api/works/${w.id}/rubric/publish`));
      expect(res.status).toBe(404);
    });
  });
});

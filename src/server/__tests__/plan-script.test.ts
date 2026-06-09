import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

// S5 (PRD-0007) — plan/script.md (剧本 narrative outline) is a first-class,
// read/write, watch-refreshable artifact, twinning composition.yaml.
//
// Contract pinned here:
//  - GET returns the raw markdown as text/plain.
//  - GET when the file does NOT exist returns an EMPTY string (200), NEVER a
//    hardcoded template in any language (#73/#83 i18n-string-as-data鐵律).
//  - PUT writes the body verbatim into plan/script.md (mkdir -p plan/) and
//    broadcasts "plan-changed" on the uiEventBus so Studio refetches without a
//    reload (mirror of composition's write-path broadcast).
describe("/api/works/:id/plan/script.md", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("GET returns empty string (200) when script.md does not exist — no template", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "T",
        type: "short-video",
        platforms: ["douyin"],
      });
      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/plan/script.md`),
      );
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toBe("");
    });
  });

  it("GET on missing work returns 404", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const res = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/nope/plan/script.md`),
      );
      expect(res.status).toBe(404);
    });
  });

  it("PUT writes the markdown and GET returns the same text verbatim", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const w = await createWork({
        title: "T",
        type: "short-video",
        platforms: ["douyin"],
      });
      const md = "# 主题\n\n一段叙事总纲。\n\n- beat 1\n- beat 2\n";
      const put = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/plan/script.md`, {
          method: "PUT",
          headers: { "content-type": "text/markdown" },
          body: md,
        }),
      );
      expect(put.status).toBe(200);

      const get = await apiRoutes.fetch(
        new Request(`http://localhost/api/works/${w.id}/plan/script.md`),
      );
      expect(get.status).toBe(200);
      expect(get.headers.get("content-type") ?? "").toContain("text/");
      const body = await get.text();
      expect(body).toBe(md);
    });
  });

  it("PUT broadcasts plan-changed on the uiEventBus", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const { uiEventBus } = await import("../bridge/ui-events.js");
      const w = await createWork({
        title: "T",
        type: "short-video",
        platforms: ["douyin"],
      });

      const got: string[] = [];
      const off = uiEventBus.subscribe(w.id, (ev) => {
        if (ev.type === "plan-changed") got.push(ev.type);
      });
      try {
        const put = await apiRoutes.fetch(
          new Request(`http://localhost/api/works/${w.id}/plan/script.md`, {
            method: "PUT",
            headers: { "content-type": "text/markdown" },
            body: "hello",
          }),
        );
        expect(put.status).toBe(200);
        expect(got).toContain("plan-changed");
      } finally {
        off();
      }
    });
  });

  it("PUT on missing work returns 404 (no file written, no broadcast)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { uiEventBus } = await import("../bridge/ui-events.js");
      let fired = false;
      const off = uiEventBus.subscribe("nope", (ev) => {
        if (ev.type === "plan-changed") fired = true;
      });
      try {
        const res = await apiRoutes.fetch(
          new Request(`http://localhost/api/works/nope/plan/script.md`, {
            method: "PUT",
            headers: { "content-type": "text/markdown" },
            body: "x",
          }),
        );
        expect(res.status).toBe(404);
        expect(fired).toBe(false);
      } finally {
        off();
      }
    });
  });
});

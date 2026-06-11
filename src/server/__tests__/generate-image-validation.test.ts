// C1.2 (PRD-0009) — POST /api/generate/image hardening, symmetric with the
// /api/generate/video endpoint:
//   1. an illegal aspectRatio is rejected LOCALLY (400) BEFORE forwarding to a
//      paid OpenRouter model that would 400 with an error body leaking the
//      internal model id (openai/gpt-5.4-image-2-…) and account id (user_2x…).
//   2. a provider error that DOES escape (real upstream failure) is sanitized
//      for the client — model id / account id stripped, actionable text kept.
//   3. missing-field errors NAME the field (parity with BGM's
//      'Missing required fields: workId, prompt').

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";
import type { ImageOpts } from "../../providers/base.js";

describe("POST /api/generate/image · local validation + error sanitization (C1.2)", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "";
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  /** Register a capturing fake as the default image provider. By default it
   *  fails (capture-only); pass a result factory to drive the success/error
   *  path. Must run AFTER vi.resetModules(). */
  async function setupFakeImageProvider(
    result?: (opts: ImageOpts) => Awaited<ReturnType<NonNullable<import("../../providers/base.js").GenerateProvider["generateImage"]>>>,
  ): Promise<ImageOpts[]> {
    const { registerProvider } = await import("../../providers/registry.js");
    const calls: ImageOpts[] = [];
    registerProvider({
      name: "fake-image",
      capability: "image",
      envKey: "FAKE_IMAGE",
      default: true,
      generateImage: async (opts) => {
        calls.push(opts);
        return result ? result(opts) : { success: false, error: "capture-only fake" };
      },
    });
    return calls;
  }

  it("rejects an illegal aspectRatio LOCALLY (400) without forwarding to the provider", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeImageProvider();
      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/image", {
          workId: w.id,
          prompt: "p",
          filename: "x.png",
          aspectRatio: "99:1", // not a supported ratio
        }),
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      // The error lists the legal enum so the agent learns the bound.
      expect(String(json.error)).toMatch(/aspectRatio/i);
      expect(String(json.error)).toContain("16:9");
      // Crucially the paid provider was NEVER called.
      expect(calls).toHaveLength(0);
    });
  });

  it("accepts a supported aspectRatio (forwards to the provider)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      const calls = await setupFakeImageProvider();
      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/image", {
          workId: w.id,
          prompt: "p",
          filename: "x.png",
          aspectRatio: "16:9",
        }),
      );
      // capture-only fake returns success:false → route 500, but the point is it
      // got past local validation and reached the provider.
      expect(calls).toHaveLength(1);
      expect(calls[0].aspectRatio).toBe("16:9");
    });
  });

  it("sanitizes a provider error body — strips internal model id + account id", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../domain/work-store.js");
      // Simulate the real leak: OpenRouter 400 whose body names the model and
      // the account. This is exactly what reached the client in the冒烟.
      const leaky =
        'OpenRouter API error 400: {"error":{"message":"Invalid value","code":"invalid_request","param":"aspect_ratio"},' +
        '"model":"openai/gpt-5.4-image-2-20260601","account":"user_2xKf9Qmost","org":"org_secret"}';
      await setupFakeImageProvider(() => ({ success: false, error: leaky, code: "API_ERROR" }));
      const w = await createWork({ title: "w", type: "short-video", platforms: ["douyin"] });

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/image", {
          workId: w.id,
          prompt: "p",
          filename: "x.png",
          aspectRatio: "1:1", // legal → reaches the provider, which 'fails'
        }),
      );
      const json: any = await res.json();
      const serialized = JSON.stringify(json);
      // The internal identifiers must NOT survive to the client.
      expect(serialized).not.toContain("openai/gpt-5.4-image-2");
      expect(serialized).not.toContain("user_2xKf9QmoSt".slice(0, 5)); // account prefix
      expect(serialized).not.toContain("user_2x");
      expect(serialized).not.toContain("org_secret");
      // …but an actionable description still survives.
      expect(String(json.error).length).toBeGreaterThan(0);
    });
  });

  it("missing-field error NAMES the absent fields (parity with BGM)", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      await setupFakeImageProvider();

      const res = await apiRoutes.fetch(
        jsonReq("POST", "/api/generate/image", { prompt: "p" }), // no workId, no filename
      );
      expect(res.status).toBe(400);
      const json: any = await res.json();
      expect(String(json.error)).toMatch(/workId/);
      expect(String(json.error)).toMatch(/filename/);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, ApiError } from "./api";

describe("apiFetch", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns parsed JSON on 200", async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, n: 1 }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const data = await apiFetch<{ ok: boolean; n: number }>("/api/works");
    expect(data).toEqual({ ok: true, n: 1 });
  });

  it("throws ApiError on 4xx with status + body", async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ error: "bad" }), { status: 400, headers: { "content-type": "application/json" } }),
    );
    await expect(apiFetch("/api/works")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
    });
  });

  it("returns text when content-type is not json", async () => {
    (global.fetch as any).mockResolvedValue(new Response("plain", { status: 200 }));
    expect(await apiFetch<string>("/api/x")).toBe("plain");
  });
});

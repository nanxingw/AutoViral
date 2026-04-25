import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, ApiError } from "./api";

describe("apiFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
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
    const promise = apiFetch("/api/works");
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
    });
  });

  it("returns text when content-type is not json", async () => {
    (global.fetch as any).mockResolvedValue(new Response("plain", { status: 200 }));
    expect(await apiFetch<string>("/api/x")).toBe("plain");
  });

  it("does NOT set content-type header when there is no body", async () => {
    let captured: HeadersInit | undefined;
    (global.fetch as any).mockImplementation((_url: string, init: RequestInit) => {
      captured = init.headers;
      return Promise.resolve(new Response("ok", { status: 200 }));
    });
    await apiFetch("/api/x");
    const ct = new Headers(captured ?? {}).get("content-type");
    expect(ct).toBeNull();
  });

  it("sets content-type=application/json when body is provided", async () => {
    let captured: HeadersInit | undefined;
    (global.fetch as any).mockImplementation((_url: string, init: RequestInit) => {
      captured = init.headers;
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }));
    });
    await apiFetch("/api/x", { method: "POST", body: { a: 1 } });
    const ct = new Headers(captured ?? {}).get("content-type");
    expect(ct).toBe("application/json");
  });

  it("appends defined query params and omits undefined", async () => {
    let url = "";
    (global.fetch as any).mockImplementation((u: string) => {
      url = u;
      return Promise.resolve(new Response("ok", { status: 200 }));
    });
    await apiFetch("/api/x", { query: { a: 1, b: undefined, c: "z", d: false } });
    expect(url).toBe("/api/x?a=1&c=z&d=false");
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadScript, saveScript } from "./script";
import { useScript } from "../scriptStore";
import { ApiError } from "@/lib/api";

// S5 (PRD-0007) — the 剧本 (plan/script.md) read/write service + store.
//   - loadScript GETs text/markdown → returns the raw string. An EMPTY body
//     (no script written yet) returns "" — NOT a template (#73/#83 i18n鐵律).
//   - saveScript PUTs the RAW markdown bytes (text/markdown), NOT JSON — the
//     server route reads c.req.text(). A failure surfaces as ApiError.
//   - the scriptStore holds the single markdown string + loaded flag.

const markdownHeaders = {
  get: (k: string) =>
    k.toLowerCase() === "content-type" ? "text/markdown; charset=utf-8" : null,
};
const jsonHeaders = {
  get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null),
};

beforeEach(() => {
  vi.restoreAllMocks();
  useScript.getState().reset();
});

describe("loadScript", () => {
  it("returns the raw markdown text from GET /plan/script.md", async () => {
    const md = "# 主题\n\n叙事总纲\n";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: markdownHeaders,
      text: async () => md,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await loadScript("w1");
    expect(out).toBe(md);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/works/w1/plan/script.md");
  });

  it("returns an empty string when no script written yet (NOT a template)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: markdownHeaders,
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await loadScript("w1");
    expect(out).toBe("");
  });
});

describe("saveScript", () => {
  it("PUTs the RAW markdown body with text/markdown content-type (not JSON)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: jsonHeaders,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const md = "# new\n\nbody with \"quotes\" and {braces}\n";
    await saveScript("w1", md);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/works/w1/plan/script.md");
    const opts = init as RequestInit;
    expect(opts.method).toBe("PUT");
    // The body is the RAW string — NOT JSON.stringify'd (which would add quotes
    // + escapes and break c.req.text()).
    expect(opts.body).toBe(md);
    const ct = (opts.headers as Record<string, string>)["content-type"];
    expect(ct).toContain("text/markdown");
  });

  it("throws ApiError on a non-ok response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: jsonHeaders,
      json: async () => ({ error: "Work not found", errorCode: "work_not_found" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveScript("nope", "x")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("scriptStore", () => {
  it("setScript stamps the owning workId, replaces the text, and flips loaded", () => {
    expect(useScript.getState().workId).toBeNull();
    expect(useScript.getState().script).toBe("");
    expect(useScript.getState().loaded).toBe(false);
    useScript.getState().setScript("w1", "# hi\n");
    expect(useScript.getState().workId).toBe("w1");
    expect(useScript.getState().script).toBe("# hi\n");
    expect(useScript.getState().loaded).toBe(true);
  });

  it("reset clears tenancy synchronously (workId/script/loaded) for a work switch", () => {
    // HIGH fix: a global store shared across works MUST drop the previous work's
    // 剧本 on switch, else B shows/commits A's script during B's load window.
    useScript.getState().setScript("wA", "A's outline\n");
    expect(useScript.getState().workId).toBe("wA");
    useScript.getState().reset();
    expect(useScript.getState().workId).toBeNull();
    expect(useScript.getState().script).toBe("");
    expect(useScript.getState().loaded).toBe(false);
  });
});

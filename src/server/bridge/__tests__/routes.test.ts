// Bridge router smoke tests. Phase 0 only exercises whoami — the rest of
// the surface grows in Phase 2-3 with corresponding tests. See
// docs/superpowers/plans/2026-05-14-agentic-terminal-refactor.md.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bridgeRouter } from "../routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_WORKS_ROOT = join(__dirname, "../../../../tests/fixtures");

const app = new Hono().route("/api/bridge/v1", bridgeRouter);

describe("bridge router — Phase 0", () => {
  it("GET /whoami echoes the workId header + returns version", async () => {
    const res = await app.request("/api/bridge/v1/whoami", {
      headers: { "X-AutoViral-Work-Id": "w_test_001" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result?: { workId: string; cwd: string; port: number; version: string };
    };
    expect(body.ok).toBe(true);
    expect(body.result?.workId).toBe("w_test_001");
    expect(body.result?.cwd).toMatch(/\.autoviral\/works\/w_test_001$/);
    expect(typeof body.result?.port).toBe("number");
    expect(body.result?.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("GET /whoami without header → 400 with code 4", async () => {
    const res = await app.request("/api/bridge/v1/whoami");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string; code?: number };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/X-AutoViral-Work-Id/);
    expect(body.code).toBe(4);
  });
});

describe("bridge router — Phase 2 read-only composition", () => {
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;
  beforeAll(() => {
    process.env.AUTOVIRAL_WORKS_ROOT = FIXTURE_WORKS_ROOT;
  });
  afterAll(() => {
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
  });

  it("GET /comp returns the parsed Composition for the workId header", async () => {
    const res = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": "sample-work" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result?: { workId: string; tracks: Array<{ kind: string }> };
    };
    expect(body.ok).toBe(true);
    expect(body.result?.workId).toBe("sample-work");
    expect(body.result?.tracks.some((t) => t.kind === "video")).toBe(true);
  });

  it("GET /comp without header → 400", async () => {
    const res = await app.request("/api/bridge/v1/comp");
    expect(res.status).toBe(400);
  });

  it("GET /comp with unknown workId → 500 with file-not-found message", async () => {
    const res = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": "no-such-work" },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/ENOENT|no such file/i);
  });

  it("GET /clips returns flattened clip summaries across all tracks", async () => {
    const res = await app.request("/api/bridge/v1/clips", {
      headers: { "X-AutoViral-Work-Id": "sample-work" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result?: Array<{ id: string; kind: string; trackKind: string; duration: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.result?.length).toBeGreaterThanOrEqual(3);
    const kinds = body.result?.map((c) => c.kind);
    expect(kinds).toContain("video");
    expect(kinds).toContain("audio");
    expect(kinds).toContain("text");
  });

  it("GET /clips?track=video filters to the video track only", async () => {
    const res = await app.request("/api/bridge/v1/clips?track=video", {
      headers: { "X-AutoViral-Work-Id": "sample-work" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result?: Array<{ trackKind: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.result?.length).toBeGreaterThan(0);
    expect(body.result?.every((c) => c.trackKind === "video")).toBe(true);
  });

  it("GET /assets returns the asset registry", async () => {
    const res = await app.request("/api/bridge/v1/assets", {
      headers: { "X-AutoViral-Work-Id": "sample-work" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result?: Array<{ id: string; kind: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.result?.length).toBeGreaterThan(0);
  });

  it("GET /assets?kind=video filters by asset kind", async () => {
    const res = await app.request("/api/bridge/v1/assets?kind=video", {
      headers: { "X-AutoViral-Work-Id": "sample-work" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result?: Array<{ kind: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.result?.every((a) => a.kind === "video")).toBe(true);
  });
});

describe("bridge router — Phase 2 docs", () => {
  const prevManualDir = process.env.AUTOVIRAL_MANUAL_DIR;
  const MANUAL_DIR = join(__dirname, "../../../../skills/autoviral/manual");
  beforeAll(() => {
    process.env.AUTOVIRAL_MANUAL_DIR = MANUAL_DIR;
  });
  afterAll(() => {
    if (prevManualDir === undefined) delete process.env.AUTOVIRAL_MANUAL_DIR;
    else process.env.AUTOVIRAL_MANUAL_DIR = prevManualDir;
  });

  it("GET /docs returns concatenated markdown", async () => {
    const res = await app.request("/api/bridge/v1/docs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    const text = await res.text();
    expect(text).toMatch(/autoviral CLI/);
  });

  it("GET /docs?topic=00-overview returns the named file", async () => {
    const res = await app.request("/api/bridge/v1/docs?topic=00-overview");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/overview/i);
  });

  it("GET /docs?topic=does-not-exist → 404", async () => {
    const res = await app.request("/api/bridge/v1/docs?topic=does-not-exist");
    expect(res.status).toBe(404);
  });
});

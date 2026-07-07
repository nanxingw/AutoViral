// C3 F5 (PRD-0010 E2E R2) — empty-work graceful degradation.
//
// A real work that has NO composition.yaml yet (created via API/CLI, or opened
// in the Studio before its first autosave) is the common state codex探路 lands
// in. The read-projection routes (GET /comp, /clips, /assets) used to hit
// `readCompositionFor` → ENOENT → a NAKED 500, which the CLI maps to exit 3
// ("the service broke") — a lie: nothing broke, the work just has zero content
// yet. This is the same family as 0681dc8 (focus naked-500 → structured 400):
// an expected边界 must degrade to a structured, agent-branchable response.
//
// Contract after the fix:
//   - real work, no composition.yaml  → 200 with the empty projection
//     (clips: [], assets: [], /comp: makeEmptyComposition's default lanes).
//     NO disk write — GET stays side-effect-free (the write path still owns
//     seeding). An agent's first `clips list` on a fresh work sees "0 clips",
//     not a crash.
//   - genuinely-missing work (getWork → undefined) → structured 404 + code:4
//     so the CLI exits 4 ("your input was wrong — no such work"), not 3.
//
// getWork resolves the work off dataDir (frozen), which a temp-worksRoot test
// can't populate — so we mock it (the SAME technique composition-ops.test.ts
// uses for the write-path seed). importOriginal is spread so every OTHER
// work-store export the router transitively needs stays real.
import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

vi.mock("../../../domain/work-store.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../domain/work-store.js")>();
  return { ...actual, getWork: vi.fn() };
});
import { getWork } from "../../../domain/work-store.js";
import { bridgeRouter } from "../routes.js";

const mockGetWork = vi.mocked(getWork);
const app = new Hono().route("/api/bridge/v1", bridgeRouter);

describe("bridge router — empty-work read-projection degradation (C3 F5)", () => {
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;
  let workRoot: string;
  const workId = "w_empty_real";

  beforeEach(async () => {
    // A work dir that exists but has NO composition.yaml — the fresh-work state.
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-empty-work-"));
    await mkdir(join(workRoot, workId), { recursive: true });
    process.env.AUTOVIRAL_WORKS_ROOT = workRoot;
    mockGetWork.mockReset();
  });
  afterAll(() => {
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
  });

  it("GET /clips on a real work with no composition.yaml → 200 empty list (not naked 500)", async () => {
    mockGetWork.mockResolvedValue({ id: workId, type: "short-video" } as never);
    const res = await app.request("/api/bridge/v1/clips", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.result).toEqual([]);
  });

  it("GET /assets on a real work with no composition.yaml → 200 empty list", async () => {
    mockGetWork.mockResolvedValue({ id: workId, type: "short-video" } as never);
    const res = await app.request("/api/bridge/v1/assets", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.result).toEqual([]);
  });

  it("GET /comp on a real work with no composition.yaml → 200 empty composition with default lanes", async () => {
    mockGetWork.mockResolvedValue({ id: workId, type: "short-video" } as never);
    const res = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result: { workId: string; tracks: unknown[]; assets: unknown[] };
    };
    expect(body.ok).toBe(true);
    expect(body.result.workId).toBe(workId);
    expect(Array.isArray(body.result.tracks)).toBe(true);
    expect(body.result.tracks.length).toBeGreaterThan(0);
    expect(body.result.assets).toEqual([]);
  });

  it("empty-work GET /comp does NOT write composition.yaml to disk (GET stays side-effect-free)", async () => {
    mockGetWork.mockResolvedValue({ id: workId, type: "short-video" } as never);
    await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const { access } = await import("node:fs/promises");
    await expect(
      access(join(workRoot, workId, "composition.yaml")),
    ).rejects.toBeTruthy();
  });

  it("GET /clips on a NONEXISTENT work (getWork → undefined) → structured 404 + code 4", async () => {
    mockGetWork.mockResolvedValue(undefined);
    const res = await app.request("/api/bridge/v1/clips", {
      headers: { "X-AutoViral-Work-Id": "w_ghost" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      ok: boolean;
      code: number;
      error: string;
    };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
    expect(body.error).toMatch(/not found|no such work/i);
  });

  it("GET /assets on a NONEXISTENT work → structured 404 + code 4", async () => {
    mockGetWork.mockResolvedValue(undefined);
    const res = await app.request("/api/bridge/v1/assets", {
      headers: { "X-AutoViral-Work-Id": "w_ghost" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; code: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });
});

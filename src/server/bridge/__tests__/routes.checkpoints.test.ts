// S21 (US 33/34) — agent-reachable checkpoint restore via the bridge.
//
// The CLI verb `autoviral checkpoint list|restore` round-trips through these
// two endpoints so the agent can safely roll back a hand-edited deliverable.
// The contract the test pins:
//   GET  /checkpoints           → list history (newest first, incl. #90 label)
//   POST /restore { file }      → roll back, AND snapshot the CURRENT live state
//                                  FIRST (#68 — restore is itself a destructive
//                                  write; without a pre-snapshot the user's
//                                  pending edits are lost forever).
//
// checkpoints.ts resolves its store off `dataDir` (AUTOVIRAL_DATA_DIR captured
// at module load), so we set the env BEFORE dynamically importing the router.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORK_ID = "w_ckpt_test";

async function withRouter<T>(
  fn: (app: { request: (path: string, init?: RequestInit) => Promise<Response> }, dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "av-ckpt-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  // Bridge ops (composition/carousel) resolve off AUTOVIRAL_WORKS_ROOT, but the
  // checkpoint routes only touch checkpoints.ts which uses dataDir — keep the
  // works root pointed at the same tree so both agree on disk layout.
  process.env.AUTOVIRAL_WORKS_ROOT = join(dir, "works");
  vi.resetModules();
  const { Hono } = await import("hono");
  const { bridgeRouter } = await import("../routes.js");
  const app = new Hono().route("/api/bridge/v1", bridgeRouter);
  try {
    return await fn(app, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.AUTOVIRAL_DATA_DIR;
    delete process.env.AUTOVIRAL_WORKS_ROOT;
  }
}

function hdr(): HeadersInit {
  return { "X-AutoViral-Work-Id": WORK_ID };
}

describe("bridge router — S21 checkpoint list/restore", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.resetModules());

  it("GET /checkpoints lists history newest-first incl. label", async () => {
    await withRouter(async (app, dir) => {
      const { createCheckpoint } = await import("../../checkpoints.js");
      const wDir = join(dir, "works", WORK_ID);
      await mkdir(wDir, { recursive: true });

      await writeFile(join(wDir, "carousel.yaml"), "id: c1\nworkId: w\nslides: []\n", "utf-8");
      await createCheckpoint(WORK_ID, "first cut");
      await writeFile(join(wDir, "carousel.yaml"), "id: c1\nworkId: w\nslides: [{}]\n", "utf-8");
      await createCheckpoint(WORK_ID);

      const res = await app.request("/api/bridge/v1/checkpoints", { headers: hdr() });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        result?: Array<{ file: string; sha: string; deliverable: string; label?: string }>;
      };
      expect(body.ok).toBe(true);
      expect(body.result).toHaveLength(2);
      // newest first
      expect(body.result![0].file > body.result![1].file).toBe(true);
      // #90 label survives the round-trip
      const labelled = body.result!.find((c) => c.label === "first cut");
      expect(labelled).toBeDefined();
    });
  });

  it("GET /checkpoints without work header → 400 code 4", async () => {
    await withRouter(async (app) => {
      const res = await app.request("/api/bridge/v1/checkpoints");
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; code?: number };
      expect(body.ok).toBe(false);
      expect(body.code).toBe(4);
    });
  });

  it("POST /restore rolls back the deliverable AND snapshots current state FIRST (#68)", async () => {
    await withRouter(async (app, dir) => {
      const { createCheckpoint, listCheckpoints } = await import("../../checkpoints.js");
      const wDir = join(dir, "works", WORK_ID);
      await mkdir(wDir, { recursive: true });

      // v1 — the state we will later want to restore.
      const v1 = "id: c1\nworkId: w\nslides: []\n";
      await writeFile(join(wDir, "carousel.yaml"), v1, "utf-8");
      await createCheckpoint(WORK_ID);
      const [snap1] = await listCheckpoints(WORK_ID);
      expect(snap1).toBeDefined();

      // v2 — a NEW live edit that was NEVER checkpointed (autosave path).
      // If restore doesn't pre-snapshot, this is lost forever.
      const v2 = "id: c1\nworkId: w\nslides: [{},{}]\n";
      await writeFile(join(wDir, "carousel.yaml"), v2, "utf-8");

      const res = await app.request("/api/bridge/v1/restore", {
        method: "POST",
        headers: { ...hdr(), "content-type": "application/json" },
        body: JSON.stringify({ file: snap1.file }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        result?: { deliverable: string; preRestoreSnapshot: { sha: string } | null };
      };
      expect(body.ok).toBe(true);
      expect(body.result?.deliverable).toBe("carousel.yaml");

      // Live file is now back to v1.
      expect(await readFile(join(wDir, "carousel.yaml"), "utf-8")).toBe(v1);

      // EXPLICIT #68 assertion: the pre-restore v2 state was snapshotted FIRST,
      // so the destructive restore is reversible. Endpoint reports it...
      expect(body.result?.preRestoreSnapshot).not.toBeNull();
      // ...and it is genuinely on disk (v2 sha present among checkpoints).
      const after = await listCheckpoints(WORK_ID);
      const shas = after.map((c) => c.sha);
      const { createHash } = await import("node:crypto");
      const v2Sha = createHash("sha256").update(v2).digest("hex").slice(0, 8);
      expect(shas).toContain(v2Sha);
    });
  });

  it("POST /restore with unknown file → 404 code 4", async () => {
    await withRouter(async (app, dir) => {
      const wDir = join(dir, "works", WORK_ID);
      await mkdir(wDir, { recursive: true });
      const res = await app.request("/api/bridge/v1/restore", {
        method: "POST",
        headers: { ...hdr(), "content-type": "application/json" },
        body: JSON.stringify({ file: "2099-01-01T00-00-00-000Z__deadbeef__carousel.yaml" }),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { ok: boolean; code?: number };
      expect(body.ok).toBe(false);
      expect(body.code).toBe(4);
    });
  });

  it("POST /restore without file field → 400 code 4", async () => {
    await withRouter(async (app) => {
      const res = await app.request("/api/bridge/v1/restore", {
        method: "POST",
        headers: { ...hdr(), "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; code?: number };
      expect(body.ok).toBe(false);
      expect(body.code).toBe(4);
    });
  });
});

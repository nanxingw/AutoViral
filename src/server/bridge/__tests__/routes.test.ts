// Bridge router smoke tests. Phase 0 only exercises whoami — the rest of
// the surface grows in Phase 2-3 with corresponding tests. See
// docs/archive/plans/2026-05-14-agentic-terminal-refactor.md.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bridgeRouter } from "../routes.js";
import { uiEventBus } from "../ui-events.js";

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

describe("bridge router — Phase 3 UI commands", () => {
  // Each POST publishes a UiEvent; we subscribe and assert the type+payload.
  function captureNext(workId: string): Promise<{ type: string; payload: unknown }> {
    return new Promise((resolve) => {
      const off = uiEventBus.subscribe(workId, (event) => {
        off();
        resolve({ type: event.type, payload: event.payload });
      });
    });
  }

  it("POST /select publishes ui-select with the target", async () => {
    const got = captureNext("w_cmd_1");
    const res = await app.request("/api/bridge/v1/select", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_cmd_1",
      },
      body: JSON.stringify({ target: { kind: "clip", id: "vc_s07" } }),
    });
    expect(res.status).toBe(200);
    const ev = await got;
    expect(ev.type).toBe("ui-select");
    expect(ev.payload).toEqual({ kind: "clip", id: "vc_s07" });
  });

  it("POST /seek publishes ui-seek with seconds", async () => {
    const got = captureNext("w_cmd_2");
    const res = await app.request("/api/bridge/v1/seek", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_cmd_2",
      },
      body: JSON.stringify({ seconds: 12.5 }),
    });
    expect(res.status).toBe(200);
    const ev = await got;
    expect(ev.type).toBe("ui-seek");
    expect(ev.payload).toEqual({ seconds: 12.5 });
  });

  it("POST /play publishes ui-play (null payload)", async () => {
    const got = captureNext("w_cmd_3");
    const res = await app.request("/api/bridge/v1/play", {
      method: "POST",
      headers: { "X-AutoViral-Work-Id": "w_cmd_3" },
    });
    expect(res.status).toBe(200);
    const ev = await got;
    expect(ev.type).toBe("ui-play");
  });

  it("POST /pause publishes ui-pause", async () => {
    const got = captureNext("w_cmd_4");
    const res = await app.request("/api/bridge/v1/pause", {
      method: "POST",
      headers: { "X-AutoViral-Work-Id": "w_cmd_4" },
    });
    expect(res.status).toBe(200);
    const ev = await got;
    expect(ev.type).toBe("ui-pause");
  });

  it("POST /toast publishes ui-toast with parsed defaults", async () => {
    const got = captureNext("w_cmd_5");
    const res = await app.request("/api/bridge/v1/toast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_cmd_5",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(200);
    const ev = await got;
    expect(ev.type).toBe("ui-toast");
    expect(ev.payload).toMatchObject({ message: "hello", kind: "info", durationMs: 3000 });
  });

  it("POST /progress passes through the discriminated phase", async () => {
    const got = captureNext("w_cmd_6");
    const res = await app.request("/api/bridge/v1/progress", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_cmd_6",
      },
      body: JSON.stringify({ phase: "start", label: "render", steps: 3 }),
    });
    expect(res.status).toBe(200);
    const ev = await got;
    expect(ev.type).toBe("ui-progress");
    expect(ev.payload).toEqual({ phase: "start", label: "render", steps: 3 });
  });

  it("POST /select without workId header → 400", async () => {
    const res = await app.request("/api/bridge/v1/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: { kind: "none" } }),
    });
    expect(res.status).toBe(400);
  });
});

describe("bridge router — Phase 3 clip writes", () => {
  // Use a real tmpdir so atomic renames + zod round-trips actually exercise.
  // Seeded from the sample-work fixture each test for isolation.
  let workRoot: string;
  const workId = "w_clip";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;

  beforeAll(async () => {
    const { mkdtemp, readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-clip-route-"));
    const fixture = await readFile(
      join(__dirname, "../../../../tests/fixtures/sample-work/composition.yaml"),
      "utf8",
    );
    await mkdir(join(workRoot, workId), { recursive: true });
    await writeFile(
      join(workRoot, workId, "composition.yaml"),
      fixture.replace(/workId: sample-work/, `workId: ${workId}`),
      "utf8",
    );
    process.env.AUTOVIRAL_WORKS_ROOT = workRoot;
  });
  afterAll(() => {
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
  });

  it("POST /clip appends a video clip and returns the new id", async () => {
    const res = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/sample-shot.mp4",
        track: "video",
        offset: 4.0,
        duration: 3.0,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.result?.id).toMatch(/^vc_/);

    // Verify it shows up in GET /clips
    const list = await app.request("/api/bridge/v1/clips", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const listBody = (await list.json()) as { result: Array<{ id: string }> };
    expect(listBody.result.some((c) => c.id === body.result!.id)).toBe(true);
  });

  it("DELETE /clip/:id removes the clip", async () => {
    const post = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/sample-shot.mp4",
        track: "video",
        offset: 8.0,
        duration: 2.0,
      }),
    });
    const id = ((await post.json()) as { result: { id: string } }).result.id;
    const del = await app.request(`/api/bridge/v1/clip/${id}`, {
      method: "DELETE",
      headers: { "X-AutoViral-Work-Id": workId },
    });
    expect(del.status).toBe(200);
    const list = await app.request("/api/bridge/v1/clips", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const listBody = (await list.json()) as { result: Array<{ id: string }> };
    expect(listBody.result.some((c) => c.id === id)).toBe(false);
  });

  it("PATCH /clip/:id updates fields", async () => {
    const post = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/sample-shot.mp4",
        track: "video",
        offset: 11.0,
        duration: 2.0,
      }),
    });
    const id = ((await post.json()) as { result: { id: string } }).result.id;
    const patch = await app.request(`/api/bridge/v1/clip/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ trackOffset: 15.5 }),
    });
    expect(patch.status).toBe(200);
    const comp = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const body = (await comp.json()) as {
      result: { tracks: Array<{ clips: Array<{ id: string; trackOffset: number }> }> };
    };
    const found = body.result.tracks
      .flatMap((t) => t.clips)
      .find((cl) => cl.id === id);
    expect(found?.trackOffset).toBe(15.5);
  });

  // S11 (US 13/14/15) — PATCH /clip now routes through ops.patchClipProps so a
  // NESTED dotted path lands at the right place (not silently stripped by the
  // non-strict CompositionSchema).
  it("PATCH /clip/:id writes a nested transforms.scale path", async () => {
    const post = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/sample-shot.mp4",
        track: "video",
        offset: 20.0,
        duration: 2.0,
      }),
    });
    const id = ((await post.json()) as { result: { id: string } }).result.id;
    const patch = await app.request(`/api/bridge/v1/clip/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ "transforms.scale": 2 }),
    });
    expect(patch.status).toBe(200);
    const comp = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const body = (await comp.json()) as {
      result: {
        tracks: Array<{
          clips: Array<{ id: string; transforms?: { scale: number } }>;
        }>;
      };
    };
    const found = body.result.tracks
      .flatMap((t) => t.clips)
      .find((cl) => cl.id === id);
    expect(found?.transforms?.scale).toBe(2);
  });

  // S11 fix-up — prove the REAL contract behind the CLI's `--ducking '{...}'`
  // ergonomic: the CLI flattens that object to dotted leaves
  // (`ducking.ratio` / `.attack` / `.release`), and the server's audio
  // whitelist accepts EXACTLY those dotted leaves (a bare `ducking` key is NOT
  // whitelisted). `ac_bgm01` is the fixture's audio clip with NO ducking yet, so
  // a complete-object patch mints `ducking` from its three leaves and survives
  // the zod write (which requires all three siblings). This closes the
  // mock-only-green gap the adversarial review flagged: cli.test's PATCH mock
  // blindly stored the body, so the documented ergonomic was never exercised
  // against the real op.
  it("PATCH /clip/:id writes the flattened ducking.* dotted leaves onto an audio clip", async () => {
    const patch = await app.request(`/api/bridge/v1/clip/ac_bgm01`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      // What `--ducking '{"ratio":0.4,"attack":0.1,"release":0.2}'` flattens to.
      body: JSON.stringify({
        "ducking.ratio": 0.4,
        "ducking.attack": 0.1,
        "ducking.release": 0.2,
      }),
    });
    expect(patch.status).toBe(200);
    const comp = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const body = (await comp.json()) as {
      result: {
        tracks: Array<{
          clips: Array<{
            id: string;
            ducking?: { ratio: number; attack: number; release: number };
          }>;
        }>;
      };
    };
    const found = body.result.tracks
      .flatMap((t) => t.clips)
      .find((cl) => cl.id === "ac_bgm01");
    expect(found?.ducking?.ratio).toBe(0.4);
    expect(found?.ducking?.attack).toBe(0.1);
    expect(found?.ducking?.release).toBe(0.2);
  });

  // S11 fix-up — and once `ducking` EXISTS, a single dotted leaf deep-merges
  // (the other two siblings survive). This is the case where patching ONE leaf
  // alone is valid — proving the dot-path write is a deep-merge, not a replace.
  it("PATCH /clip/:id deep-merges a single ducking.ratio leaf when ducking already exists", async () => {
    const patch = await app.request(`/api/bridge/v1/clip/ac_bgm01`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ "ducking.ratio": 0.9 }),
    });
    expect(patch.status).toBe(200);
    const comp = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const body = (await comp.json()) as {
      result: {
        tracks: Array<{
          clips: Array<{
            id: string;
            ducking?: { ratio: number; attack: number; release: number };
          }>;
        }>;
      };
    };
    const found = body.result.tracks
      .flatMap((t) => t.clips)
      .find((cl) => cl.id === "ac_bgm01");
    expect(found?.ducking?.ratio).toBe(0.9);
    // siblings from the previous complete-object patch survive the merge.
    expect(found?.ducking?.attack).toBe(0.1);
    expect(found?.ducking?.release).toBe(0.2);
  });

  // S11 fix-up — the inverse: a BARE `ducking` object key (what the CLI used to
  // send before flattening) is NOT in the audio whitelist, so it must be a 400
  // code:4. This documents WHY the CLI flattens — sending the raw object would
  // 400 the documented ergonomic.
  it("PATCH /clip/:id rejects a bare `ducking` object key with 400 code:4 (only dotted leaves are whitelisted)", async () => {
    const patch = await app.request(`/api/bridge/v1/clip/ac_bgm01`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ ducking: { ratio: 0.4, attack: 0.1, release: 0.2 } }),
    });
    expect(patch.status).toBe(400);
    const body = (await patch.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  // S11 — an unknown / misspelled key is REJECTED with 400 + code:4, never a
  // silent no-op (PRD-0004 #4). `transforms.scal` is the canonical typo.
  it("PATCH /clip/:id rejects an unknown/misspelled key with 400 code:4", async () => {
    const post = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/sample-shot.mp4",
        track: "video",
        offset: 24.0,
        duration: 2.0,
      }),
    });
    const id = ((await post.json()) as { result: { id: string } }).result.id;
    const patch = await app.request(`/api/bridge/v1/clip/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ "transforms.scal": 2 }),
    });
    expect(patch.status).toBe(400);
    const body = (await patch.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  // S11 — per-kind whitelist enforced at the route: `volume` is an audio-only
  // field, so PATCHing it onto a VIDEO clip is a 400 code:4.
  it("PATCH /clip/:id rejects a wrong-kind field (audio field on a video clip)", async () => {
    const post = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/sample-shot.mp4",
        track: "video",
        offset: 28.0,
        duration: 2.0,
      }),
    });
    const id = ((await post.json()) as { result: { id: string } }).result.id;
    const patch = await app.request(`/api/bridge/v1/clip/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ volume: 0.3 }),
    });
    expect(patch.status).toBe(400);
    const body = (await patch.json()) as { ok: boolean; code?: number };
    expect(body.code).toBe(4);
  });

  // S11 — an unknown clip id is likewise a code:4 rejection (not a silent 200).
  it("PATCH /clip/:id rejects an unknown clip id with 400 code:4", async () => {
    const patch = await app.request(`/api/bridge/v1/clip/nope_does_not_exist`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ trackOffset: 1 }),
    });
    expect(patch.status).toBe(400);
    const body = (await patch.json()) as { ok: boolean; code?: number };
    expect(body.code).toBe(4);
  });

  // S6 (US 1/9) — POST /split delegates to the shared `ops.splitClip`. The
  // fixture's `vc_s01` is a video clip in:0 out:4 trackOffset:0 (timeline
  // 0..4). Splitting at 2.0 → child A keeps the id + out:2, child B is a new
  // id with in:2 trackOffset:2.
  it("POST /split cuts a clip into two, rebasing in/out + trackOffset", async () => {
    const res = await app.request("/api/bridge/v1/split", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ clipId: "vc_s01", at: 2.0 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { id: string } };
    expect(body.ok).toBe(true);
    expect(typeof body.result?.id).toBe("string");
    const newId = body.result!.id;

    const comp = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const compBody = (await comp.json()) as {
      result: { tracks: Array<{ clips: Array<{ id: string; in?: number; out?: number; trackOffset: number }> }> };
    };
    const all = compBody.result.tracks.flatMap((t) => t.clips);
    const childA = all.find((c) => c.id === "vc_s01");
    const childB = all.find((c) => c.id === newId);
    expect(childA?.out).toBeCloseTo(2);
    expect(childA?.trackOffset).toBeCloseTo(0);
    expect(childB?.in).toBeCloseTo(2);
    expect(childB?.trackOffset).toBeCloseTo(2);
  });

  it("POST /split with an unknown clipId → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/split", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ clipId: "nope", at: 2.0 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  it("POST /split with an out-of-clip time → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/split", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ clipId: "vc_s01", at: 99 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /split without a work-id header → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipId: "vc_s01", at: 2.0 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /split broadcasts composition-changed after the write lands", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      // Add a fresh splittable clip so this test doesn't depend on prior splits.
      const add = await app.request("/api/bridge/v1/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ src: "assets/sample-shot.mp4", track: "video", offset: 30, duration: 4 }),
      });
      const addedId = ((await add.json()) as { result: { id: string } }).result.id;
      events.length = 0;
      const res = await app.request("/api/bridge/v1/split", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ clipId: addedId, at: 32 }),
      });
      expect(res.status).toBe(200);
      expect(events).toContain("composition-changed");
    } finally {
      off();
    }
  });

  // A rejected split must NOT broadcast — disk untouched, so a "changed" event
  // would lie.
  it("POST /split with an unknown clip does NOT broadcast composition-changed", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request("/api/bridge/v1/split", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ clipId: "nope", at: 2.0 }),
      });
      expect(res.status).toBe(400);
      expect(events).not.toContain("composition-changed");
    } finally {
      off();
    }
  });

  // S7 (US 2/9) — POST /clip/:id/trim delegates to the shared `ops.trimClip`.
  // The fixture's `vc_s01` is a video clip in:0 out:4 trackOffset:0 (single
  // clip on its track → no neighbour cap). Trimming out to 2.0 shrinks the
  // source window in place; trackOffset stays anchored.
  it("POST /clip/:id/trim sets out in place, trackOffset anchored", async () => {
    const res = await app.request("/api/bridge/v1/clip/vc_s01/trim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ out: 2.0 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.result?.id).toBe("vc_s01");

    const comp = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const compBody = (await comp.json()) as {
      result: { tracks: Array<{ clips: Array<{ id: string; in?: number; out?: number; trackOffset: number }> }> };
    };
    const clip = compBody.result.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === "vc_s01");
    expect(clip?.in).toBeCloseTo(0);
    expect(clip?.out).toBeCloseTo(2);
    expect(clip?.trackOffset).toBeCloseTo(0);
  });

  it("POST /clip/:id/trim with an unknown clipId → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/clip/nope/trim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ out: 2.0 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  it("POST /clip/:id/trim without in/out → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/clip/vc_s01/trim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /clip/:id/trim on a text clip → 400 + code 4 (no in/out window)", async () => {
    const res = await app.request("/api/bridge/v1/clip/tc_hook01/trim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ out: 2.0 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /clip/:id/trim without a work-id header → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/clip/vc_s01/trim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ out: 2.0 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /clip/:id/trim broadcasts composition-changed after the write lands", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      // Add a fresh trimmable clip so this test is independent of prior trims.
      const add = await app.request("/api/bridge/v1/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ src: "assets/sample-shot.mp4", track: "video", offset: 50, duration: 4 }),
      });
      const addedId = ((await add.json()) as { result: { id: string } }).result.id;
      events.length = 0;
      const res = await app.request("/api/bridge/v1/clip/" + addedId + "/trim", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ out: 2 }),
      });
      expect(res.status).toBe(200);
      expect(events).toContain("composition-changed");
    } finally {
      off();
    }
  });

  it("POST /clip/:id/trim with an unknown clip does NOT broadcast", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request("/api/bridge/v1/clip/nope/trim", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ out: 2 }),
      });
      expect(res.status).toBe(400);
      expect(events).not.toContain("composition-changed");
    } finally {
      off();
    }
  });

  // S2 (US 17) — a successful clip write broadcasts composition-changed on
  // the uiEventBus right after the atomic write lands, so Studio refetches
  // without depending on fs.watch.
  it("POST /clip broadcasts composition-changed after the write lands", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request("/api/bridge/v1/clip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AutoViral-Work-Id": workId,
        },
        body: JSON.stringify({
          src: "assets/sample-shot.mp4",
          track: "video",
          offset: 20.0,
          duration: 2.0,
        }),
      });
      expect(res.status).toBe(200);
      expect(events).toContain("composition-changed");
    } finally {
      off();
    }
  });

  // S2 — a REJECTED clip write (no track / bad shape) must NOT broadcast:
  // disk is untouched, so a "changed" event would be a lie.
  it("POST /clip with a missing src does NOT broadcast composition-changed", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request("/api/bridge/v1/clip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AutoViral-Work-Id": workId,
        },
        // video clip with no src → mutator throws → write never happens.
        body: JSON.stringify({ track: "video", offset: 1.0, duration: 2.0 }),
      });
      expect(res.status).toBe(400);
      expect(events).not.toContain("composition-changed");
    } finally {
      off();
    }
  });

  // S3 (US 18/19) — every 400 on the clip endpoints carries code:4 so the
  // CLI (and any raw HTTP caller) can branch "validation error" → exit 4 vs
  // "service error" (5xx) → exit 3. These mirror the carousel endpoints
  // which already tagged their 400s; the clip trio had been emitting bare
  // `{ ok:false, error }` 400s.
  it("POST /clip missing track → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ src: "assets/sample-shot.mp4", offset: 1.0 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  it("POST /clip with a rejected mutator (video clip, no src) → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      // video clip without src → mutator throws → caught 400.
      body: JSON.stringify({ track: "video", offset: 1.0, duration: 2.0 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  it("PATCH /clip/:id with an invalid patch → 400 + code 4", async () => {
    // Seed a real clip, then patch it with a field that fails schema
    // validation on write (trackOffset must be a number).
    const post = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/sample-shot.mp4",
        track: "video",
        offset: 30.0,
        duration: 2.0,
      }),
    });
    const id = ((await post.json()) as { result: { id: string } }).result.id;
    const patch = await app.request(`/api/bridge/v1/clip/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ trackOffset: "not-a-number" }),
    });
    expect(patch.status).toBe(400);
    const body = (await patch.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });
});

describe("bridge router — Phase 3 approval gate", () => {
  it("POST /ask blocks until an approval-response is delivered (yes)", async () => {
    // Capture the askId from the broadcast ui-ask event, then call
    // answerAsk to simulate the Studio's ApprovalPrompt clicking YES.
    const { answerAsk } = await import("../approval-gate.js");
    let captured: { askId: string } | null = null;
    const off = uiEventBus.subscribe("w_ask_1", (event) => {
      if (event.type === "ui-ask") captured = event.payload as { askId: string };
    });

    const askPromise = app.request("/api/bridge/v1/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_ask_1",
      },
      body: JSON.stringify({ message: "Run it?", kind: "yes-no", timeoutMs: 30_000 }),
    });

    // Wait a tick so the ui-ask broadcast fires before we try to answer.
    await new Promise((r) => setTimeout(r, 10));
    expect(captured).not.toBeNull();
    expect(answerAsk(captured!.askId, "yes")).toBe(true);

    const res = await askPromise;
    off();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { answer: string } };
    expect(body.ok).toBe(true);
    expect(body.result?.answer).toBe("yes");
  });

  it("POST /ask returns 504 + code 124 on timeout", async () => {
    const res = await app.request("/api/bridge/v1/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_ask_2",
      },
      body: JSON.stringify({ message: "no listener", kind: "yes-no", timeoutMs: 50 }),
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { ok: boolean; error: string; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(124);
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
    expect(text).toMatch(/autoviral/i);
  });

  it("GET /docs?topic=_shared/00-quickstart returns the named subdir file (I09 co-location)", async () => {
    const res = await app.request(
      "/api/bridge/v1/docs?topic=" + encodeURIComponent("_shared/00-quickstart"),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/quickstart/i);
  });

  it("GET /docs?topic=video/02-composition-schema returns the nested video chapter (I09)", async () => {
    const res = await app.request(
      "/api/bridge/v1/docs?topic=" + encodeURIComponent("video/02-composition-schema"),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/composition/i);
  });

  it("GET /docs?topic=does-not-exist → 404", async () => {
    const res = await app.request("/api/bridge/v1/docs?topic=does-not-exist");
    expect(res.status).toBe(404);
  });

  // I08 — subdir-aware topic resolution (groundwork for I09).
  it("GET /docs?topic=carousel/02-schema returns the nested carousel chapter", async () => {
    const res = await app.request(
      "/api/bridge/v1/docs?topic=" + encodeURIComponent("carousel/02-schema"),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/Carousel schema/i);
    expect(text).toMatch(/discriminated union/i);
  });

  it("GET /docs (no topic) includes the carousel subdir chapter in the full dump", async () => {
    const res = await app.request("/api/bridge/v1/docs");
    const text = await res.text();
    expect(text).toMatch(/Carousel schema/i);
  });

  it("GET /docs?topic=../../package rejects path traversal with 404", async () => {
    const res = await app.request(
      "/api/bridge/v1/docs?topic=" + encodeURIComponent("../../package"),
    );
    expect(res.status).toBe(404);
  });
});

describe("bridge router — I08 carousel writes", () => {
  let workRoot: string;
  const workId = "w_car";
  let slideId = "";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;

  beforeAll(async () => {
    const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const yamlMod = (await import("js-yaml")).default;
    const { makeEmptyCarousel } = await import("../../../shared/carousel.js");
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-carousel-route-"));
    await mkdir(join(workRoot, workId), { recursive: true });
    await writeFile(
      join(workRoot, workId, "carousel.yaml"),
      yamlMod.dump(makeEmptyCarousel(workId), { lineWidth: -1 }),
      "utf8",
    );
    process.env.AUTOVIRAL_WORKS_ROOT = workRoot;
  });
  afterAll(() => {
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
  });

  it("POST /carousel/slide appends a slide and returns its id", async () => {
    const res = await app.request("/api/bridge/v1/carousel/slide", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { id: string } };
    expect(body.ok).toBe(true);
    expect(typeof body.result?.id).toBe("string");
    slideId = body.result!.id;
  });

  it("POST /carousel/slide/:id/layer adds a text layer (zod fills style defaults)", async () => {
    const res = await app.request(
      `/api/bridge/v1/carousel/slide/${encodeURIComponent(slideId)}/layer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({
          kind: "text",
          box: { x: 80, y: 80, w: 920, h: 200 },
          text: "标题",
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { id: string } };
    expect(body.ok).toBe(true);
    expect(typeof body.result?.id).toBe("string");
  });

  it("POST layer with a bogus kind → 400 + code 4, carousel.yaml untouched", async () => {
    const { readFile } = await import("node:fs/promises");
    const target = join(workRoot, workId, "carousel.yaml");
    const before = await readFile(target, "utf8");
    const res = await app.request(
      `/api/bridge/v1/carousel/slide/${encodeURIComponent(slideId)}/layer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ kind: "bogus", box: { x: 0, y: 0, w: 1, h: 1 } }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("POST layer onto a non-existent slide → 400", async () => {
    const res = await app.request(
      "/api/bridge/v1/carousel/slide/s_nope/layer",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ kind: "text", box: { x: 0, y: 0, w: 1, h: 1 }, text: "x" }),
      },
    );
    expect(res.status).toBe(400);
  });

  // S2 (US 17) — a successful carousel write broadcasts carousel-changed on
  // the uiEventBus right after the atomic write lands, so the Editor
  // refetches without depending on fs.watch.
  it("POST /carousel/slide broadcasts carousel-changed after the write lands", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request("/api/bridge/v1/carousel/slide", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      expect(events).toContain("carousel-changed");
    } finally {
      off();
    }
  });

  // S2 — a REJECTED carousel write must NOT broadcast (disk untouched).
  it("POST layer with a bogus kind does NOT broadcast carousel-changed", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request(
        `/api/bridge/v1/carousel/slide/${encodeURIComponent(slideId)}/layer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
          body: JSON.stringify({ kind: "bogus", box: { x: 0, y: 0, w: 1, h: 1 } }),
        },
      );
      expect(res.status).toBe(400);
      expect(events).not.toContain("carousel-changed");
    } finally {
      off();
    }
  });

  it("POST /carousel/slide without the work-id header → 400", async () => {
    const res = await app.request("/api/bridge/v1/carousel/slide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("bridge router — H0.1 focus channel", () => {
  it("GET /focus returns EMPTY_FOCUS for a fresh work", async () => {
    const res = await app.request("/api/bridge/v1/focus", {
      headers: { "X-AutoViral-Work-Id": "w_focus_fresh" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result?: { selectedClipId: string | null };
    };
    expect(body.ok).toBe(true);
    expect(body.result?.selectedClipId).toBeNull();
  });

  it("POST /focus persists the patch and the next GET reflects it", async () => {
    const post = await app.request("/api/bridge/v1/focus", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_focus_post",
      },
      body: JSON.stringify({ selectedClipId: "vc_s07" }),
    });
    expect(post.status).toBe(200);

    const get = await app.request("/api/bridge/v1/focus", {
      headers: { "X-AutoViral-Work-Id": "w_focus_post" },
    });
    const getBody = (await get.json()) as {
      result: { selectedClipId: string | null };
    };
    expect(getBody.result.selectedClipId).toBe("vc_s07");
  });

  it("POST /focus broadcasts ui-focus on uiEventBus", async () => {
    const events: unknown[] = [];
    const unsub = uiEventBus.subscribe("w_focus_bus", (e) => {
      events.push(e);
    });
    await app.request("/api/bridge/v1/focus", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_focus_bus",
      },
      body: JSON.stringify({ selectedClipId: "vc_x" }),
    });
    unsub();
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe("ui-focus");
  });

  it("POST /focus silently strips unknown keys (forward-compat)", async () => {
    // zod's default object() strips unknown keys rather than rejecting —
    // intentional so the schema can grow in H0.2 (playheadSec, etc.)
    // without breaking older clients sending only what they know.
    const res = await app.request("/api/bridge/v1/focus", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_focus_extra",
      },
      body: JSON.stringify({ selectedClipId: "vc_x", futureField: "ignored" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: Record<string, unknown>;
    };
    expect(body.result.selectedClipId).toBe("vc_x");
    expect(body.result).not.toHaveProperty("futureField");
  });

  it("POST /focus accepts selectedClipId:null to clear", async () => {
    await app.request("/api/bridge/v1/focus", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_focus_clear",
      },
      body: JSON.stringify({ selectedClipId: "vc_first" }),
    });
    await app.request("/api/bridge/v1/focus", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_focus_clear",
      },
      body: JSON.stringify({ selectedClipId: null }),
    });
    const res = await app.request("/api/bridge/v1/focus", {
      headers: { "X-AutoViral-Work-Id": "w_focus_clear" },
    });
    const body = (await res.json()) as { result: { selectedClipId: string | null } };
    expect(body.result.selectedClipId).toBeNull();
  });
});

describe("bridge router — H0.3 context channel", () => {
  it("GET /context returns workId + focus + composition + inject flag", async () => {
    const res = await app.request("/api/bridge/v1/context", {
      headers: { "X-AutoViral-Work-Id": "w_ctx_get" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result: {
        workId: string;
        focus: { selectedClipId: string | null };
        composition: unknown;
        terminalInjectEnabled: boolean;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.result.workId).toBe("w_ctx_get");
    expect(body.result.focus).toBeDefined();
    expect(body.result.terminalInjectEnabled).toBe(true);
  });

  it("POST /context/inject flips the flag", async () => {
    const off = await app.request("/api/bridge/v1/context/inject", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_inject",
      },
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);
    const ctxRes = await app.request("/api/bridge/v1/context", {
      headers: { "X-AutoViral-Work-Id": "w_inject" },
    });
    const ctx = (await ctxRes.json()) as {
      result: { terminalInjectEnabled: boolean };
    };
    expect(ctx.result.terminalInjectEnabled).toBe(false);
  });

  it("POST /context/inject broadcasts ui-context-inject on the bus", async () => {
    const events: unknown[] = [];
    const unsub = uiEventBus.subscribe("w_inject_bus", (e) => {
      events.push(e);
    });
    await app.request("/api/bridge/v1/context/inject", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": "w_inject_bus",
      },
      body: JSON.stringify({ enabled: true }),
    });
    unsub();
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe("ui-context-inject");
  });
});

// ─── S4 (US 10) — PUT /comp: the full-composition write escape hatch ─────────
// The agent's universal write path: a complete composition body goes through
// the SAME chokepoint as every intent verb (writeCompositionFor → zod validate
// → tmpfile → atomic rename), then broadcasts composition-changed so Studio
// refetches. An invalid composition is rejected with 400 + code:4 and the
// on-disk composition.yaml is left BYTE-FOR-BYTE untouched (validation happens
// before any tmpfile is allocated).
describe("bridge router — S4 PUT /comp (full-composition write)", () => {
  let workRoot: string;
  const workId = "w_put";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;
  let fixtureYaml: string;

  beforeAll(async () => {
    const { mkdtemp, readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-put-route-"));
    fixtureYaml = (
      await readFile(
        join(__dirname, "../../../../tests/fixtures/sample-work/composition.yaml"),
        "utf8",
      )
    ).replace(/workId: sample-work/, `workId: ${workId}`);
    await mkdir(join(workRoot, workId), { recursive: true });
    await writeFile(join(workRoot, workId, "composition.yaml"), fixtureYaml, "utf8");
    process.env.AUTOVIRAL_WORKS_ROOT = workRoot;
  });
  afterAll(() => {
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
  });

  // Helper — load the current composition JSON via the GET endpoint so we can
  // mutate it and PUT a full, valid composition back.
  async function currentComp(): Promise<Record<string, unknown>> {
    const res = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    return ((await res.json()) as { result: Record<string, unknown> }).result;
  }

  it("PUT /comp writes a whole valid composition and the next GET reflects it", async () => {
    const comp = await currentComp();
    const next = { ...comp, duration: 42 };
    const res = await app.request("/api/bridge/v1/comp", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify(next),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const after = await currentComp();
    expect(after.duration).toBe(42);
  });

  it("PUT /comp without the work-id header → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/comp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  it("PUT /comp with an invalid composition → 400 + code 4 and disk is UNCHANGED", async () => {
    const { readFile } = await import("node:fs/promises");
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    const comp = await currentComp();
    // tracks must be an array — a string violates CompositionSchema, so zod
    // throws in writeCompositionFor BEFORE any tmpfile is allocated.
    const res = await app.request("/api/bridge/v1/comp", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ ...comp, tracks: "not-an-array" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
    // The whole point of the chokepoint: a rejected write leaves disk untouched.
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("PUT /comp with a non-JSON body → 400 + code 4 (never reaches the writer)", async () => {
    const res = await app.request("/api/bridge/v1/comp", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: "this is not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  it("PUT /comp broadcasts composition-changed after the write lands", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const comp = await currentComp();
      const res = await app.request("/api/bridge/v1/comp", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-AutoViral-Work-Id": workId,
        },
        body: JSON.stringify({ ...comp, duration: 7 }),
      });
      expect(res.status).toBe(200);
      expect(events).toContain("composition-changed");
    } finally {
      off();
    }
  });

  // A REJECTED full-comp write must NOT broadcast — disk is untouched, so a
  // "changed" event would lie.
  it("PUT /comp with an invalid composition does NOT broadcast composition-changed", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const comp = await currentComp();
      const res = await app.request("/api/bridge/v1/comp", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-AutoViral-Work-Id": workId,
        },
        body: JSON.stringify({ ...comp, tracks: "not-an-array" }),
      });
      expect(res.status).toBe(400);
      expect(events).not.toContain("composition-changed");
    } finally {
      off();
    }
  });

  // S4 (adversarial-review fix) — the silent-strip vector. A typo'd TOP-LEVEL
  // key (`tracts` for `tracks`, singular `exportPreset` …) must NOT 200 with
  // the field silently dropped to disk: that's data loss the agent never learns
  // about. The strict write schema rejects it → 400 + code:4, disk untouched.
  it("PUT /comp with an unknown top-level key → 400 + code 4, disk UNCHANGED", async () => {
    const { readFile } = await import("node:fs/promises");
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    const comp = await currentComp();
    const res = await app.request("/api/bridge/v1/comp", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      // `tracts` is the canonical typo — lenient zod would silently strip it.
      body: JSON.stringify({ ...comp, tracts: [] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
    expect(await readFile(target, "utf8")).toBe(before);
  });

  // S4 — same vector, one level deeper: a typo'd CLIP field must also fail loud
  // rather than be stripped (parity with the S11 `clip set` whitelist).
  it("PUT /comp with an unknown clip-level key → 400 + code 4, disk UNCHANGED", async () => {
    const { readFile } = await import("node:fs/promises");
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    const comp = await currentComp();
    const tracks = (comp.tracks as Array<Record<string, unknown>>).map((t, ti) =>
      ti === 0
        ? {
            ...t,
            clips: (t.clips as Array<Record<string, unknown>>).map((cl, ci) =>
              ci === 0 ? { ...cl, bogusClipField: 1 } : cl,
            ),
          }
        : t,
    );
    const res = await app.request("/api/bridge/v1/comp", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ ...comp, tracks }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
    expect(await readFile(target, "utf8")).toBe(before);
  });
});

// S8 (US 3/9) — POST /clip/:id/move delegates to the shared ops.moveClipToTrack.
// The seeded composition has TWO video lanes (trk_v1 holds c1 → c2 with a
// transition pinned after c1; trk_v2 is empty) so a same-kind cross-lane move is
// possible. The key invariant: moving c1 away from trk_v1 orphans the transition
// pinned to it — the op must prune it, otherwise writeCompositionFor's
// CompositionWriteSchema.parse superRefine rejects a valid move with a 400.
describe("bridge router — S8 POST /clip/:id/move", () => {
  let workRoot: string;
  const workId = "w_move";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;

  const TWO_VIDEO_LANE_YAML = `id: c_${workId}
workId: ${workId}
fps: 30
width: 1080
height: 1920
duration: 8.0
aspect: "9:16"
updatedAt: "2026-05-14T00:00:00.000Z"
tracks:
  - id: trk_v1
    kind: video
    label: V1
    muted: false
    hidden: false
    clips:
      - id: c1
        kind: video
        src: assets/sample-shot.mp4
        in: 0
        out: 4.0
        trackOffset: 0
      - id: c2
        kind: video
        src: assets/sample-shot.mp4
        in: 0
        out: 4.0
        trackOffset: 4.0
    transitions:
      - id: tr_1
        afterClipId: c1
        preset: cross-dissolve
        durationSec: 0.5
        alignment: center
        easing: linear
  - id: trk_v2
    kind: video
    label: V2
    muted: false
    hidden: false
    clips: []
  - id: trk_a1
    kind: audio
    label: BGM
    muted: false
    hidden: false
    clips:
      - id: ac1
        kind: audio
        src: assets/sample-bgm.mp3
        in: 0
        out: 8.0
        trackOffset: 0
        type: bgm
assets: []
provenance: []
exportPresets: []
`;

  beforeAll(async () => {
    const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-move-route-"));
    await mkdir(join(workRoot, workId), { recursive: true });
    await writeFile(
      join(workRoot, workId, "composition.yaml"),
      TWO_VIDEO_LANE_YAML,
      "utf8",
    );
    process.env.AUTOVIRAL_WORKS_ROOT = workRoot;
  });
  afterAll(() => {
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
  });

  function move(id: string, body: unknown) {
    return app.request(`/api/bridge/v1/clip/${id}/move`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify(body),
    });
  }

  it("moves a clip to another same-kind lane and prunes the source-lane orphan transition", async () => {
    const res = await move("c1", { toTrackId: "trk_v2" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.result?.id).toBe("c1");

    // GET reflects: c1 left trk_v1, landed on trk_v2 (keeping trackOffset), and
    // the now-orphan transition on trk_v1 is gone — a valid write round-trip.
    const comp = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const compBody = (await comp.json()) as {
      result: {
        tracks: Array<{
          id: string;
          clips: Array<{ id: string; trackOffset: number }>;
          transitions?: Array<{ afterClipId: string }>;
        }>;
      };
    };
    const v1 = compBody.result.tracks.find((t) => t.id === "trk_v1")!;
    const v2 = compBody.result.tracks.find((t) => t.id === "trk_v2")!;
    expect(v1.clips.some((c) => c.id === "c1")).toBe(false);
    expect(v1.transitions ?? []).toHaveLength(0); // orphan pruned
    const moved = v2.clips.find((c) => c.id === "c1");
    expect(moved).toBeDefined();
    expect(moved!.trackOffset).toBeCloseTo(0); // time position preserved
  });

  it("rejects a cross-kind move (video clip → audio lane) → 400 + code 4", async () => {
    const res = await move("c2", { toTrackId: "trk_a1" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  it("rejects an unknown clipId → 400 + code 4", async () => {
    const res = await move("nope", { toTrackId: "trk_v2" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("rejects an unknown target track → 400 + code 4", async () => {
    const res = await move("c2", { toTrackId: "trk_does_not_exist" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("rejects a missing toTrackId → 400 + code 4", async () => {
    const res = await move("c2", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("rejects a missing work-id header → 400 + code 4", async () => {
    const res = await app.request(`/api/bridge/v1/clip/c2/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toTrackId: "trk_v2" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });
});

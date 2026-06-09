// Bridge router smoke tests. Phase 0 only exercises whoami — the rest of
// the surface grows in Phase 2-3 with corresponding tests. See
// docs/archive/plans/2026-05-14-agentic-terminal-refactor.md.

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// S14 (US 20/21) — mock the ASR core so the bridge wire test asserts the
// caption→text-clip plumbing without a real whisper venv. The real
// transcription path is covered at DeferredToE2E (needs a venv/audio file).
vi.mock("../../../domain/asr-captions.js", () => ({
  runAsrCaptions: vi.fn(),
}));
import { runAsrCaptions } from "../../../domain/asr-captions.js";
import { bridgeRouter } from "../routes.js";
import { uiEventBus } from "../ui-events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_WORKS_ROOT = join(__dirname, "../../../../tests/fixtures");
// The single source of truth for the version `whoami` reports is the repo's
// package.json. Pinning the assertion to it (not a loose semver regex) is what
// catches a hardcoded/stale BRIDGE_VERSION drifting on the next bump.
const REPO_PKG_VERSION = (
  JSON.parse(
    readFileSync(join(__dirname, "../../../../package.json"), "utf-8"),
  ) as { version: string }
).version;

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
    // The reported version must be the real package version — not a hardcoded
    // constant that silently drifts when the package is bumped.
    expect(body.result?.version).toBe(REPO_PKG_VERSION);
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

  // S9 (US 4/5/9) — POST /transition + DELETE /transition/:id delegate to the
  // shared `ops.addTransition` / `ops.removeTransition`. The describe's on-disk
  // composition accumulates across tests (no per-test reset), so we never rely on
  // `vc_s01` being last; instead each test appends its OWN pair of adjacent video
  // clips and pins the transition between the two ids it just minted — order-
  // independent. The fixture's legacy track id `video-0` is rewritten by
  // `migrateLegacyTrackIds` on read, so we resolve the live video-track id at
  // runtime rather than hardcoding it.
  async function videoTrackId(): Promise<string> {
    const comp = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const body = (await comp.json()) as {
      result: { tracks: Array<{ id: string; kind: string }> };
    };
    return body.result.tracks.find((t) => t.kind === "video")!.id;
  }
  async function addVideoClip(offset: number): Promise<string> {
    const add = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ src: "assets/sample-shot.mp4", track: "video", offset, duration: 4 }),
    });
    expect(add.status).toBe(200);
    return ((await add.json()) as { result: { id: string } }).result.id;
  }

  it("POST /transition adds a cross-dissolve after a clip + DELETE restores the hard cut", async () => {
    const first = await addVideoClip(100);
    await addVideoClip(104); // successor → `first` is no longer last
    const vTrack = await videoTrackId();
    const post = await app.request("/api/bridge/v1/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ trackId: vTrack, afterClipId: first, preset: "cross-dissolve" }),
    });
    expect(post.status).toBe(200);
    const postBody = (await post.json()) as { ok: boolean; result?: { id: string } };
    expect(postBody.ok).toBe(true);
    expect(postBody.result?.id).toMatch(/^tr_/);
    const transitionId = postBody.result!.id;

    // Read back: the transition is on the video track, pinned to `first`.
    const comp = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const compBody = (await comp.json()) as {
      result: { tracks: Array<{ id: string; transitions?: Array<{ id: string; afterClipId: string; preset: string }> }> };
    };
    const v0 = compBody.result.tracks.find((t) => t.id === vTrack)!;
    const tr = v0.transitions?.find((x) => x.id === transitionId);
    expect(tr?.afterClipId).toBe(first);
    expect(tr?.preset).toBe("cross-dissolve");

    // DELETE restores the hard cut (transition gone).
    const del = await app.request(`/api/bridge/v1/transition/${transitionId}`, {
      method: "DELETE",
      headers: { "X-AutoViral-Work-Id": workId },
    });
    expect(del.status).toBe(200);
    const comp2 = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const compBody2 = (await comp2.json()) as {
      result: { tracks: Array<{ id: string; transitions?: Array<{ id: string }> }> };
    };
    const v0After = compBody2.result.tracks.find((t) => t.id === vTrack)!;
    expect(v0After.transitions?.some((x) => x.id === transitionId) ?? false).toBe(false);
  });

  it("POST /transition pinned to the LAST clip → 400 + code 4", async () => {
    // Add a clip and pin a transition AFTER it while it is the last clip → reject.
    const last = await addVideoClip(200);
    const vTrack = await videoTrackId();
    const res = await app.request("/api/bridge/v1/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ trackId: vTrack, afterClipId: last, preset: "cross-dissolve" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  it("POST /transition with an unknown preset → 400 + code 4", async () => {
    const first = await addVideoClip(300);
    await addVideoClip(304);
    const vTrack = await videoTrackId();
    const res = await app.request("/api/bridge/v1/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ trackId: vTrack, afterClipId: first, preset: "no-such-preset" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /transition without a work-id header → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId: "video-0", afterClipId: "vc_s01", preset: "cross-dissolve" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("DELETE /transition/:id with an unknown id → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/transition/tr_ghost", {
      method: "DELETE",
      headers: { "X-AutoViral-Work-Id": workId },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /transition broadcasts composition-changed after the write lands", async () => {
    const first = await addVideoClip(400);
    await addVideoClip(404);
    const vTrack = await videoTrackId();
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request("/api/bridge/v1/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ trackId: vTrack, afterClipId: first, preset: "wipe-left" }),
      });
      expect(res.status).toBe(200);
      expect(events).toContain("composition-changed");
    } finally {
      off();
    }
  });

  it("POST /transition rejected (last-clip) does NOT broadcast", async () => {
    const last = await addVideoClip(500);
    const vTrack = await videoTrackId();
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request("/api/bridge/v1/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ trackId: vTrack, afterClipId: last, preset: "cross-dissolve" }),
      });
      expect(res.status).toBe(400);
      expect(events).not.toContain("composition-changed");
    } finally {
      off();
    }
  });

  // S12 (US 16 / 35-37) — POST /clip/:id/keyframe delegates to the shared
  // `ops.addKeyframe`. The fixture's `vc_s01` is a video clip → keyframe-capable;
  // `tc_hook01` is text → D8 reject. This is the runnable replacement for the
  // dead `clip set --keyframes` path.
  it("POST /clip/:id/keyframe authors an opacity keyframe in place + echoes the id", async () => {
    const res = await app.request("/api/bridge/v1/clip/vc_s01/keyframe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ property: "opacity", atSec: 2, value: 0.5, easing: "easeOut" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.result?.id).toBe("vc_s01");

    const comp = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const compBody = (await comp.json()) as {
      result: {
        tracks: Array<{
          clips: Array<{
            id: string;
            keyframes?: Array<{ property: string; time: number; value: number; easing: string }>;
          }>;
        }>;
      };
    };
    const clip = compBody.result.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === "vc_s01");
    const kf = clip?.keyframes?.find((k) => k.property === "opacity" && k.time === 2);
    expect(kf?.value).toBe(0.5);
    expect(kf?.easing).toBe("easeOut");
  });

  it("POST /clip/:id/keyframe is idempotent on a (property, atSec) collision (D4)", async () => {
    const headers = { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId };
    await app.request("/api/bridge/v1/clip/vc_s01/keyframe", {
      method: "POST",
      headers,
      body: JSON.stringify({ property: "scale", atSec: 1, value: 1 }),
    });
    await app.request("/api/bridge/v1/clip/vc_s01/keyframe", {
      method: "POST",
      headers,
      body: JSON.stringify({ property: "scale", atSec: 1, value: 1.5 }),
    });
    const comp = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const compBody = (await comp.json()) as {
      result: { tracks: Array<{ clips: Array<{ id: string; keyframes?: Array<{ property: string; time: number; value: number }> }> }> };
    };
    const clip = compBody.result.tracks.flatMap((t) => t.clips).find((c) => c.id === "vc_s01");
    const scaleKfs = (clip?.keyframes ?? []).filter((k) => k.property === "scale" && k.time === 1);
    expect(scaleKfs).toHaveLength(1);
    expect(scaleKfs[0].value).toBe(1.5);
  });

  it("POST /clip/:id/keyframe onto a text clip → 400 + code 4 (D8)", async () => {
    const res = await app.request("/api/bridge/v1/clip/tc_hook01/keyframe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ property: "opacity", atSec: 1, value: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  it("POST /clip/:id/keyframe with an unknown property → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/clip/vc_s01/keyframe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ property: "bogus", atSec: 1, value: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /clip/:id/keyframe with an unknown clipId → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/clip/nope/keyframe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ property: "opacity", atSec: 1, value: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /clip/:id/keyframe without a work-id header → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/clip/vc_s01/keyframe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property: "opacity", atSec: 1, value: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /clip/:id/keyframe broadcasts composition-changed after the write lands", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      // S12 bound — `atSec` must land within vc_s01's CURRENT clip-local span.
      // This describe shares ONE on-disk comp across tests (seeded in beforeAll,
      // not beforeEach), and the earlier split / trim tests shrank vc_s01 from
      // out:4 down to out:2. So a keyframe at atSec 3 now (correctly) 400s past
      // the clip's duration; atSec 1 is a legal write inside the current [0, 2]
      // span and still exercises the broadcast path this test cares about.
      const res = await app.request("/api/bridge/v1/clip/vc_s01/keyframe", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ property: "x", atSec: 1, value: 10 }),
      });
      expect(res.status).toBe(200);
      expect(events).toContain("composition-changed");
    } finally {
      off();
    }
  });
});

// ─── S2 (PRD-0007) — scene (分镜 / storyboard) write routes ───────────────────
// The five scene verbs delegate to the SAME `@shared` ops the Studio store runs
// (ops.addScene/setSceneProps/reorderScenes/linkSceneAssets/removeScene) via
// mutateCompositionFor + the reused `composition-changed` broadcast — so an
// agent driving via `autoviral scene …` and a human editing a card converge on
// one `comp.scenes` record (ADR-009 agent-人一致). Each verb mirrors /split:
// happy → 200, illegal params (missing title / unknown id / non-array) throw
// CompositionOpError{code:4} → 400 + code:4, and a rejected write must NOT
// broadcast (disk untouched). Strict `scenes` write-schema closes the silent-
// strip vector (a typo'd scene field fails loud instead of being dropped).
describe("bridge router — S2 scene writes", () => {
  let workRoot: string;
  const workId = "w_scene";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;

  beforeAll(async () => {
    const { mkdtemp, readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-scene-route-"));
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

  // Helper — read scenes via the GET /comp endpoint (round-trips through disk).
  async function currentScenes(): Promise<
    Array<{ id: string; order: number; title: string; intent?: string }>
  > {
    const res = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const body = (await res.json()) as {
      result: { scenes?: Array<{ id: string; order: number; title: string; intent?: string }> };
    };
    return body.result.scenes ?? [];
  }

  // Helper — add a scene and return its minted id.
  async function addScene(title: string, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await app.request("/api/bridge/v1/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ title, ...extra }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { result: { sceneId: string } }).result.sceneId;
  }

  // ── POST /scene (add) ──────────────────────────────────────────────────────
  it("POST /scene appends a scene to composition.yaml scenes[] and returns the id", async () => {
    const res = await app.request("/api/bridge/v1/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ title: "开场钩子", intent: "hook" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { sceneId: string } };
    expect(body.ok).toBe(true);
    expect(body.result?.sceneId).toMatch(/^scn_/);

    // The scene really landed on disk (read back via GET /comp).
    const scenes = await currentScenes();
    const added = scenes.find((s) => s.id === body.result!.sceneId);
    expect(added).toBeDefined();
    expect(added?.title).toBe("开场钩子");
    expect(added?.intent).toBe("hook");
    // order is auto-assigned by the op (first scene → 0).
    expect(typeof added?.order).toBe("number");
  });

  it("POST /scene auto-assigns a contiguous order across adds", async () => {
    // This block already has ≥1 scene from the prior test; add two more and
    // assert orders are unique contiguous integers.
    await addScene("第二镜");
    await addScene("第三镜");
    const scenes = await currentScenes();
    const orders = scenes.map((s) => s.order).sort((a, b) => a - b);
    expect(orders).toEqual([...orders.keys()]); // 0..N-1 contiguous
  });

  it("POST /scene without a title → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ intent: "hook" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  it("POST /scene with a non-string title → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ title: 123 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /scene without a work-id header → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "无 work" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /scene broadcasts composition-changed after the write lands", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request("/api/bridge/v1/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ title: "广播镜" }),
      });
      expect(res.status).toBe(200);
      expect(events).toContain("composition-changed");
    } finally {
      off();
    }
  });

  // ── PATCH /scene/:id (set) ─────────────────────────────────────────────────
  it("PATCH /scene/:id patches editable props in place", async () => {
    const id = await addScene("待改镜");
    const res = await app.request(`/api/bridge/v1/scene/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ title: "已改镜", narration: "旁白", shotSize: "close" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

    const scenes = (await currentScenes()) as Array<
      { id: string; title: string; narration?: string; shotSize?: string }
    >;
    const after = scenes.find((s) => s.id === id);
    expect(after?.title).toBe("已改镜");
    expect(after?.narration).toBe("旁白");
    expect(after?.shotSize).toBe("close");
  });

  it("PATCH /scene/:id with an unknown id → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/scene/scn_nope", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: number }).code).toBe(4);
  });

  // The bridge does an UNTYPED read-modify-write of agent JSON. The op's runtime
  // allowlist (setSceneProps, S1) must hold END-TO-END through the route so an
  // agent can't smuggle order/id/status (owned by reorderScenes / immutable /
  // linkSceneAssets) through PATCH and break the contiguous-order invariant.
  it("PATCH /scene/:id ignores order/id/status smuggled in the body (op allowlist holds at the route)", async () => {
    const fullScene = async (sid: string) => {
      const res = await app.request("/api/bridge/v1/comp", {
        headers: { "X-AutoViral-Work-Id": workId },
      });
      const body = (await res.json()) as {
        result: { scenes?: Array<{ id: string; order: number; status?: string; title: string }> };
      };
      return (body.result.scenes ?? []).find((s) => s.id === sid);
    };
    const id = await addScene("白名单镜");
    const before = await fullScene(id);
    expect(before?.status).toBe("planned");

    const res = await app.request(`/api/bridge/v1/scene/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ title: "改了标题", order: 99, status: "generated", id: "scn_hacked" }),
    });
    expect(res.status).toBe(200);

    const after = await fullScene(id);
    // settable key applied…
    expect(after?.title).toBe("改了标题");
    // …owned-by-another-op keys rejected: order unchanged, status still planned,
    // and the scene is STILL findable by its original id (id immutable).
    expect(after?.order).toBe(before?.order);
    expect(after?.status).toBe("planned");
    expect(after?.id).toBe(id);
  });

  // Clear protocol end-to-end (real JSON + real op + real disk): a null prop
  // DELETES the optional field so it round-trips as absent. This is the wire
  // contract the card's "—"/emptied-input depends on — undefined would be
  // dropped by JSON.stringify and never reach here (the dead-clear bug).
  it("PATCH /scene/:id with a null prop clears (deletes) that optional field", async () => {
    const fullScene = async (sid: string) => {
      const res = await app.request("/api/bridge/v1/comp", {
        headers: { "X-AutoViral-Work-Id": workId },
      });
      const body = (await res.json()) as {
        result: { scenes?: Array<{ id: string; shotSize?: string }> };
      };
      return (body.result.scenes ?? []).find((s) => s.id === sid);
    };
    const id = await addScene("有景别镜", { shotSize: "long" });
    expect((await fullScene(id))?.shotSize).toBe("long");

    const res = await app.request(`/api/bridge/v1/scene/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ shotSize: null }),
    });
    expect(res.status).toBe(200);
    const after = await fullScene(id);
    expect(after?.shotSize).toBeUndefined();
    expect("shotSize" in (after ?? {})).toBe(false); // truly absent on disk
  });

  // A negative durationSec is a write-path rejection (SceneSchema.durationSec
  // .min(0)) — never silently persisted (the #75 clamp class, server-side).
  it("PATCH /scene/:id with a negative durationSec → 400 + code 4", async () => {
    const id = await addScene("时长镜");
    const res = await app.request(`/api/bridge/v1/scene/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ durationSec: -5 }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: number }).code).toBe(4);
  });

  // ── POST /scene/:id/link shape gate ────────────────────────────────────────
  it("POST /scene/:id/link without assetIds → 400 + code 4 and does NOT broadcast", async () => {
    const id = await addScene("链接镜");
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request(`/api/bridge/v1/scene/${id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ status: "generated" }), // assetIds missing
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code?: number }).code).toBe(4);
      // A rejected write must NOT broadcast — disk untouched.
      expect(events).not.toContain("composition-changed");
    } finally {
      off();
    }
  });

  // ── POST /scene/reorder ────────────────────────────────────────────────────
  it("POST /scene/reorder rewrites order to the requested permutation", async () => {
    const before = await currentScenes();
    const ids = before.map((s) => s.id);
    const reversed = [...ids].reverse();
    const res = await app.request("/api/bridge/v1/scene/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ orderedSceneIds: reversed }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

    const after = await currentScenes();
    // Sort by order → ids must now match the requested reversed sequence.
    const byOrder = [...after].sort((a, b) => a.order - b.order).map((s) => s.id);
    expect(byOrder).toEqual(reversed);
  });

  it("POST /scene/reorder with a non-array body → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/scene/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ orderedSceneIds: "not-an-array" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: number }).code).toBe(4);
  });

  it("POST /scene/reorder with an incomplete permutation → 400 + code 4", async () => {
    const scenes = await currentScenes();
    // Drop one id → not a complete permutation → op throws code:4.
    const partial = scenes.slice(1).map((s) => s.id);
    const res = await app.request("/api/bridge/v1/scene/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ orderedSceneIds: partial }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: number }).code).toBe(4);
  });

  // ── POST /scene/:id/link ───────────────────────────────────────────────────
  it("POST /scene/:id/link records generated assets + flips status", async () => {
    const id = await addScene("待链镜");
    const res = await app.request(`/api/bridge/v1/scene/${id}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ assetIds: ["a1", "a2"], selectedAssetId: "a1" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

    const scenes = (await currentScenes()) as Array<
      { id: string; generatedAssetIds?: string[]; selectedAssetId?: string; status?: string }
    >;
    const after = scenes.find((s) => s.id === id);
    expect(after?.generatedAssetIds).toEqual(["a1", "a2"]);
    expect(after?.selectedAssetId).toBe("a1");
    expect(after?.status).toBe("generated");
  });

  it("POST /scene/:id/link with an unknown id → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/scene/scn_nope/link", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ assetIds: ["a1"] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: number }).code).toBe(4);
  });

  // ── DELETE /scene/:id (remove) ─────────────────────────────────────────────
  it("DELETE /scene/:id removes the scene and recompacts order", async () => {
    const id = await addScene("待删镜");
    const del = await app.request(`/api/bridge/v1/scene/${id}`, {
      method: "DELETE",
      headers: { "X-AutoViral-Work-Id": workId },
    });
    expect(del.status).toBe(200);
    expect(((await del.json()) as { ok: boolean }).ok).toBe(true);

    const scenes = await currentScenes();
    expect(scenes.some((s) => s.id === id)).toBe(false);
    // order stays contiguous 0..N-1 after the remove.
    const orders = scenes.map((s) => s.order).sort((a, b) => a - b);
    expect(orders).toEqual([...orders.keys()]);
  });

  it("DELETE /scene/:id with an unknown id → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/scene/scn_nope", {
      method: "DELETE",
      headers: { "X-AutoViral-Work-Id": workId },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: number }).code).toBe(4);
  });

  // ── rejected writes must NOT broadcast (disk untouched) ────────────────────
  it("PATCH /scene/:id rejected (unknown id) does NOT broadcast composition-changed", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request("/api/bridge/v1/scene/scn_nope", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ title: "x" }),
      });
      expect(res.status).toBe(400);
      expect(events).not.toContain("composition-changed");
    } finally {
      off();
    }
  });

  // ── strict `scenes` write-schema (fail-loud, S4 parity) ────────────────────
  it("PUT /comp with an unknown scene-level key → 400 + code 4, disk UNCHANGED", async () => {
    const { readFile } = await import("node:fs/promises");
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    // GET the live comp (it has scenes from the adds above), inject a typo'd
    // scene field on the first scene, PUT it back. The strict scenes write
    // schema must reject it (unrecognized_keys) rather than silently strip.
    const compRes = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const comp = ((await compRes.json()) as { result: Record<string, unknown> }).result;
    const scenes = (comp.scenes as Array<Record<string, unknown>>).map((s, i) =>
      i === 0 ? { ...s, bogusSceneField: 1 } : s,
    );
    const res = await app.request("/api/bridge/v1/comp", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ ...comp, scenes }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
    // Rejected write leaves disk byte-for-byte untouched.
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("PUT /comp round-trips a comp whose scenes carry only known fields (no regression)", async () => {
    // The live comp's scenes are all op-minted (known fields only); a GET→PUT
    // round-trip must pass the strict scenes schema unchanged.
    const compRes = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const comp = ((await compRes.json()) as { result: Record<string, unknown> }).result;
    const res = await app.request("/api/bridge/v1/comp", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify(comp),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});

// ─── S7 (PRD-0007) — POST /scene/:id/generate (generation handoff) ──────────
// The route builds the prompt from the scene's OWN fields, generates ONE image
// via the provider registry OUTSIDE the lock, then registers the AssetEntry +
// provenance edge AND links it onto the scene inside ONE locked mutator. The
// keystone invariant: generatedAssetIds must NEVER reference an id absent from
// comp.assets (register + link commit atomically). We register a FAKE image
// provider (default for "image") so the slow generateImage is deterministic; on
// the failure-path test the fake returns {success:false} and the route must
// leave the comp untouched (no dangling asset, no link).
describe("bridge router — S7 scene generate handoff", () => {
  let workRoot: string;
  const workId = "w_gen";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;
  // Toggled by the failure-path test so the same fake can return {success:false}.
  let failNext = false;
  const generateCalls: Array<{ prompt: string; filename: string }> = [];

  beforeAll(async () => {
    const { mkdtemp, readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { dataDir } = await import("../../../infra/config.js");
    const { registerProvider } = await import("../../../providers/registry.js");

    workRoot = await mkdtemp(join(tmpdir(), "autoviral-scene-gen-route-"));
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

    // Register a fake image provider as the default for "image". It writes the
    // promised PNG under the per-work asset tree (so the route's absolute→work-
    // relative uri conversion strips a clean prefix) and returns its path. No
    // key needed: registration is unconditional in the test.
    registerProvider({
      name: "fake-image",
      capability: "image",
      envKey: "FAKE_IMAGE",
      default: true,
      generateImage: async (opts) => {
        generateCalls.push({ prompt: opts.prompt, filename: opts.filename });
        if (failNext) {
          return { success: false, error: "fake provider asked to fail" };
        }
        const assetDir = join(dataDir, "works", opts.workId, "assets", "fake-image");
        await mkdir(assetDir, { recursive: true });
        const assetPath = join(assetDir, opts.filename);
        await writeFile(assetPath, "fake-png-bytes", "utf8");
        return { success: true, assetPath };
      },
    });
  });
  afterAll(async () => {
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
    // Best-effort cleanup of the PNGs the fake wrote under the real dataDir.
    const { rm } = await import("node:fs/promises");
    const { dataDir } = await import("../../../infra/config.js");
    await rm(join(dataDir, "works", workId), { recursive: true, force: true }).catch(() => {});
  });

  type SceneShape = {
    id: string;
    status?: string;
    generatedAssetIds?: string[];
    selectedAssetId?: string;
    prompt?: string;
  };
  async function currentComp(): Promise<{
    scenes?: SceneShape[];
    assets?: Array<{ id: string; uri: string; kind: string }>;
    provenance?: Array<{ toAssetId: string; operation: { type: string } }>;
  }> {
    const res = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    return ((await res.json()) as { result: Awaited<ReturnType<typeof currentComp>> }).result;
  }
  async function addScene(title: string, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await app.request("/api/bridge/v1/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ title, ...extra }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { result: { sceneId: string } }).result.sceneId;
  }

  it("registers an AssetEntry, links it, flips status — generatedAssetIds[0] ∈ comp.assets (no dangling ref)", async () => {
    const id = await addScene("开场镜", {
      prompt: "wide shot of a neon city",
      shotSize: "long",
      cameraMovement: "push",
      narration: "夜幕降临",
    });
    const before = generateCalls.length;
    const res = await app.request(`/api/bridge/v1/scene/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    // Bridge envelope `{ ok, result }` (the shape the CLI's bridgeRequest
    // unwraps) — data lives under `.result`, never flat.
    const env = (await res.json()) as {
      ok: boolean;
      result: {
        assetId: string;
        assetUri: string;
        sceneId: string;
        selectedAssetId: string;
        status: string;
      };
    };
    expect(env.ok).toBe(true);
    const body = env.result;
    expect(body.assetId).toMatch(/^gen_/);
    expect(body.sceneId).toBe(id);
    expect(body.selectedAssetId).toBe(body.assetId);
    expect(body.status).toBe("generated");
    // assetUri is work-relative (prefix stripped), not absolute. The filename is
    // `scene_<id>_<take>_<rand4>.png` (random suffix makes concurrent reshoots
    // collision-proof) — assert the take-1 prefix + extension, not an exact name.
    expect(body.assetUri).toMatch(
      new RegExp(`^assets/fake-image/scene_${id}_1_[0-9a-f]{4}\\.png$`),
    );

    // The enriched prompt carried the scene's own context lines.
    const call = generateCalls[before];
    expect(call.prompt).toContain("wide shot of a neon city");
    expect(call.prompt).toContain("镜头景别: long");
    expect(call.prompt).toContain("运镜: push");
    expect(call.prompt).toContain("旁白: 夜幕降临");
    // Per-take filename (take 1 + random suffix).
    expect(call.filename).toMatch(new RegExp(`^scene_${id}_1_[0-9a-f]{4}\\.png$`));

    // THE KEYSTONE: the linked id is present in comp.assets (no dangling ref).
    const comp = await currentComp();
    const scene = comp.scenes!.find((s) => s.id === id)!;
    expect(scene.status).toBe("generated");
    expect(scene.generatedAssetIds).toEqual([body.assetId]);
    expect(scene.selectedAssetId).toBe(body.assetId);
    expect(comp.assets!.some((a) => a.id === scene.generatedAssetIds![0])).toBe(true);
    const asset = comp.assets!.find((a) => a.id === body.assetId)!;
    expect(asset.kind).toBe("image");
    expect(asset.uri).toBe(body.assetUri);
    // A provenance edge records the generate.
    expect(
      comp.provenance!.some(
        (e) => e.toAssetId === body.assetId && e.operation.type === "generate",
      ),
    ).toBe(true);
  });

  it("reshoot appends a 2nd take + moves selectedAssetId to the newest (same endpoint)", async () => {
    const id = await addScene("待重拍镜", { prompt: "a calm lake" });
    // First take.
    const r1 = await app.request(`/api/bridge/v1/scene/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({}),
    });
    const a1 = ((await r1.json()) as { result: { assetId: string } }).result.assetId;
    // Reshoot = call again.
    const r2 = await app.request(`/api/bridge/v1/scene/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({}),
    });
    expect(r2.status).toBe(200);
    const b2 = ((await r2.json()) as {
      result: { assetId: string; assetUri: string; selectedAssetId: string };
    }).result;
    expect(b2.assetId).not.toBe(a1);
    // Per-take filename increments (take 2 + random suffix).
    expect(b2.assetUri).toMatch(
      new RegExp(`^assets/fake-image/scene_${id}_2_[0-9a-f]{4}\\.png$`),
    );

    const comp = await currentComp();
    const scene = comp.scenes!.find((s) => s.id === id)!;
    expect(scene.generatedAssetIds).toEqual([a1, b2.assetId]);
    expect(scene.selectedAssetId).toBe(b2.assetId);
    // Both takes resolve in comp.assets (no dangling ref after reshoot).
    expect(comp.assets!.some((a) => a.id === a1)).toBe(true);
    expect(comp.assets!.some((a) => a.id === b2.assetId)).toBe(true);
  });

  it("unknown sceneId → 400 + code 4 (no generation attempted)", async () => {
    const before = generateCalls.length;
    const res = await app.request("/api/bridge/v1/scene/scn_nope/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: number }).code).toBe(4);
    // The provider was never called (we reject before generating).
    expect(generateCalls.length).toBe(before);
  });

  it("a scene with no prompt falls back to its title as the generation base (title-fallback success)", async () => {
    // The route's "no base → 400 code:4" branch is a DEFENSIVE guard for a
    // hand-built / legacy scene whose prompt AND title are both blank — it is
    // unreachable through the add route (title is schema-required + non-empty),
    // so we don't test the dead branch here. Instead we lock the realistic path:
    // a scene with NO prompt generates using its title as the base.
    const id = await addScene("仅标题镜"); // no prompt
    const before = generateCalls.length;
    const res = await app.request(`/api/bridge/v1/scene/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({}),
    });
    // Title is a valid base, so generation succeeds and uses the title.
    expect(res.status).toBe(200);
    expect(generateCalls.length).toBe(before + 1);
    expect(generateCalls[before].prompt).toContain("仅标题镜");
  });

  it("a provider failure → 500 + code 4 and leaves the comp UNTOUCHED (no dangling asset, no link)", async () => {
    const id = await addScene("失败镜", { prompt: "this will fail" });
    const compBefore = await currentComp();
    const assetsBefore = compBefore.assets!.length;

    failNext = true;
    let res: Response;
    try {
      res = await app.request(`/api/bridge/v1/scene/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({}),
      });
    } finally {
      failNext = false;
    }
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code?: number }).code).toBe(4);

    // No asset registered, scene still planned with empty generatedAssetIds.
    const compAfter = await currentComp();
    expect(compAfter.assets!.length).toBe(assetsBefore);
    const scene = compAfter.scenes!.find((s) => s.id === id)!;
    expect(scene.status).toBe("planned");
    expect(scene.generatedAssetIds ?? []).toEqual([]);
  });

  it("does NOT broadcast composition-changed on a failed generation", async () => {
    const id = await addScene("失败广播镜", { prompt: "fail and stay quiet" });
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    failNext = true;
    try {
      const res = await app.request(`/api/bridge/v1/scene/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(500);
      expect(events).not.toContain("composition-changed");
    } finally {
      failNext = false;
      off();
    }
  });

  it("broadcasts composition-changed after a successful generation", async () => {
    const id = await addScene("广播镜", { prompt: "broadcast me" });
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request(`/api/bridge/v1/scene/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      expect(events).toContain("composition-changed");
    } finally {
      off();
    }
  });

  it("editing the prompt after generation flips the scene to stale (stale-on-edit), reshoot re-generates", async () => {
    const id = await addScene("陈旧镜", { prompt: "v1 prompt" });
    // Generate → generated.
    await app.request(`/api/bridge/v1/scene/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({}),
    });
    // Edit the prompt via PATCH → status flips to stale (ops.setSceneProps).
    const patch = await app.request(`/api/bridge/v1/scene/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ prompt: "v2 prompt" }),
    });
    expect(patch.status).toBe(200);
    let comp = await currentComp();
    let scene = comp.scenes!.find((s) => s.id === id)!;
    expect(scene.status).toBe("stale");
    // Reshoot → back to generated, take 2 uses the new prompt.
    const before = generateCalls.length;
    const r = await app.request(`/api/bridge/v1/scene/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(200);
    expect(generateCalls[before].prompt).toContain("v2 prompt");
    comp = await currentComp();
    scene = comp.scenes!.find((s) => s.id === id)!;
    expect(scene.status).toBe("generated");
    expect(scene.generatedAssetIds!.length).toBe(2);
  });

  it("without a work-id header → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/scene/scn_x/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: number }).code).toBe(4);
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

  // set-layer PATCH semantics (the carousel twin of S11 clip-set): re-POSTing
  // with an EXISTING layer id and only --text must PRESERVE that layer's box +
  // style, not reset them to schema defaults (the pre-fix REPLACE bug).
  it("POST layer with an existing id DEEP-MERGES (box + style preserved, only text changes)", async () => {
    const { readFile } = await import("node:fs/promises");
    const yamlMod = (await import("js-yaml")).default;
    const target = join(workRoot, workId, "carousel.yaml");

    // 1. seed a fully-styled text layer with an explicit id.
    const seedRes = await app.request(
      `/api/bridge/v1/carousel/slide/${encodeURIComponent(slideId)}/layer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({
          id: "t_patch",
          kind: "text",
          box: { x: 200, y: 300, w: 640, h: 200, rotation: 9 },
          text: "原始",
          style: { font: "serif", size: 88, weight: 300, italic: true, color: "#ff0066", align: "right", tracking: 6 },
        }),
      },
    );
    expect(seedRes.status).toBe(200);

    // 2. patch ONLY the text on that same id.
    const patchRes = await app.request(
      `/api/bridge/v1/carousel/slide/${encodeURIComponent(slideId)}/layer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ id: "t_patch", kind: "text", text: "改后" }),
      },
    );
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json() as { result?: { id: string } }).result?.id).toBe("t_patch");

    // 3. read carousel.yaml off disk and assert the merge.
    const parsed = yamlMod.load(await readFile(target, "utf8")) as {
      slides: Array<{ id: string; layers: Array<Record<string, any>> }>;
    };
    const slide = parsed.slides.find((s) => s.id === slideId)!;
    const layer = slide.layers.find((l) => l.id === "t_patch")!;
    expect(layer.text).toBe("改后"); // changed
    expect(layer.box).toEqual({ x: 200, y: 300, w: 640, h: 200, rotation: 9 }); // preserved
    expect(layer.style.font).toBe("serif"); // preserved
    expect(layer.style.size).toBe(88); // preserved
    expect(layer.style.weight).toBe(300); // preserved
    expect(layer.style.italic).toBe(true); // preserved
    expect(layer.style.color).toBe("#ff0066"); // preserved
    expect(layer.style.align).toBe("right"); // preserved
    expect(layer.style.tracking).toBe(6); // preserved
    // exactly one t_patch layer (patch is in-place, not an append).
    expect(slide.layers.filter((l) => l.id === "t_patch")).toHaveLength(1);
  });

  it("POST layer changing the kind of an existing id → 400 (kind not patchable)", async () => {
    const res = await app.request(
      `/api/bridge/v1/carousel/slide/${encodeURIComponent(slideId)}/layer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
        body: JSON.stringify({ id: "t_patch", kind: "image", src: "/x.png" }),
      },
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { code?: number }).code).toBe(4);
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

// ─── S17 (US 26) — POST /comp/aspect (one-click canvas-ratio switch) ─────────
// Routes through the shared `ops.setAspectRatio` (the SAME code the Studio
// aspect control runs), so the agent CLI and the human UI converge. A valid
// ratio flips width/height + broadcasts composition-changed; an invalid ratio
// is rejected 400 + code:4 with disk untouched (and no broadcast).
describe("bridge router — S17 POST /comp/aspect", () => {
  let workRoot: string;
  const workId = "w_aspect";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;

  beforeAll(async () => {
    const { mkdtemp, readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-aspect-route-"));
    const fixtureYaml = (
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

  async function currentComp(): Promise<Record<string, unknown>> {
    const res = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    return ((await res.json()) as { result: Record<string, unknown> }).result;
  }

  it("POST /comp/aspect flips aspect/width/height and the next GET reflects it", async () => {
    const res = await app.request("/api/bridge/v1/comp/aspect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ ratio: "16:9" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    const after = await currentComp();
    expect(after.aspect).toBe("16:9");
    expect(after.width).toBe(1920);
    expect(after.height).toBe(1080);
  });

  it("POST /comp/aspect broadcasts composition-changed after the write lands", async () => {
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request("/api/bridge/v1/comp/aspect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AutoViral-Work-Id": workId,
        },
        body: JSON.stringify({ ratio: "1:1" }),
      });
      expect(res.status).toBe(200);
      expect(events).toContain("composition-changed");
    } finally {
      off();
    }
  });

  it("POST /comp/aspect with an invalid ratio → 400 + code 4, disk UNCHANGED, no broadcast", async () => {
    const { readFile } = await import("node:fs/promises");
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const res = await app.request("/api/bridge/v1/comp/aspect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AutoViral-Work-Id": workId,
        },
        body: JSON.stringify({ ratio: "21:9" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; code?: number };
      expect(body.ok).toBe(false);
      expect(body.code).toBe(4);
      expect(await readFile(target, "utf8")).toBe(before);
      expect(events).not.toContain("composition-changed");
    } finally {
      off();
    }
  });

  it("POST /comp/aspect without the work-id header → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/comp/aspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ratio: "1:1" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });
});

// ─── S13 (US 11/12) — preflight (/comp/validate) + write dry-run ─────────────
// `/comp/validate` lets the agent check a candidate composition BEFORE it ever
// touches disk — no write, no broadcast — so it can fix problems up front
// instead of the "PUT → 400 → read zod dump → guess" loop. `PUT /comp?dry-run`
// previews the SAME write path (validate + preflight) while skipping the disk
// write AND the composition-changed broadcast.
describe("bridge router — S13 /comp/validate + PUT /comp dry-run", () => {
  let workRoot: string;
  const workId = "w_validate";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;

  beforeAll(async () => {
    const { mkdtemp, readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-validate-route-"));
    const fixtureYaml = (
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

  async function currentComp(): Promise<Record<string, unknown>> {
    const res = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    return ((await res.json()) as { result: Record<string, unknown> }).result;
  }

  it("POST /comp/validate on a legal candidate → ok:true, no errors/warnings, disk UNCHANGED", async () => {
    const { readFile } = await import("node:fs/promises");
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    const comp = await currentComp();
    const res = await app.request("/api/bridge/v1/comp/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify(comp),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result: { ok: boolean; errors: string[]; warnings: string[] };
    };
    expect(body.result.ok).toBe(true);
    expect(body.result.errors).toEqual([]);
    expect(body.result.warnings).toEqual([]);
    // Preflight NEVER writes.
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("POST /comp/validate on an illegal candidate → ok:false with errors, disk UNCHANGED", async () => {
    const { readFile } = await import("node:fs/promises");
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    const comp = await currentComp();
    const res = await app.request("/api/bridge/v1/comp/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ ...comp, tracks: "not-an-array" }),
    });
    // Validate is a successful REQUEST that returns a "not ok" VERDICT — the
    // HTTP status stays 200; the verdict lives in result.ok.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { ok: boolean; errors: string[] };
    };
    expect(body.result.ok).toBe(false);
    expect(body.result.errors.length).toBeGreaterThan(0);
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("POST /comp/validate surfaces a lint warning while staying ok", async () => {
    const comp = await currentComp();
    const tracks = (comp.tracks as Array<Record<string, unknown>>).map((t) =>
      t.kind === "video"
        ? {
            ...t,
            clips: [
              ...(t.clips as Array<Record<string, unknown>>),
              {
                id: "vc_overlap",
                kind: "video",
                src: "assets/sample-shot.mp4",
                in: 0,
                out: 4,
                trackOffset: 1,
              },
            ],
          }
        : t,
    );
    const res = await app.request("/api/bridge/v1/comp/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ ...comp, tracks }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { ok: boolean; warnings: string[] };
    };
    expect(body.result.ok).toBe(true);
    expect(body.result.warnings.some((w) => w.includes("overlaps"))).toBe(true);
  });

  // S13 rework — preflight MUST agree with the write chokepoint. A typo'd
  // top-level key (`tracts`) or clip key (`bogusClipField`) is stripped by the
  // lenient read schema but REJECTED by CompositionWriteSchema at `comp put`.
  // Before this fix /comp/validate returned ok:true (false-green) for these,
  // then the subsequent PUT still 400'd — defeating the slice's whole purpose.
  it("POST /comp/validate rejects a typo'd TOP-LEVEL key (matches the write path), disk UNCHANGED", async () => {
    const { readFile } = await import("node:fs/promises");
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    const comp = await currentComp();
    const res = await app.request("/api/bridge/v1/comp/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ ...comp, tracts: [] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { ok: boolean; errors: string[] };
    };
    expect(body.result.ok).toBe(false);
    expect(body.result.errors.some((e) => e.includes("tracts"))).toBe(true);
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("POST /comp/validate rejects a typo'd CLIP-LEVEL key (matches the write path), disk UNCHANGED", async () => {
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
    const res = await app.request("/api/bridge/v1/comp/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ ...comp, tracks }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { ok: boolean; errors: string[] };
    };
    expect(body.result.ok).toBe(false);
    expect(
      body.result.errors.some((e) => e.includes("bogusClipField")),
    ).toBe(true);
    expect(await readFile(target, "utf8")).toBe(before);
  });

  it("PUT /comp?dry-run=true rejects a typo'd top-level key (same verdict the live PUT would 400 on), disk UNCHANGED", async () => {
    const { readFile } = await import("node:fs/promises");
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const comp = await currentComp();
      const res = await app.request("/api/bridge/v1/comp?dry-run=true", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-AutoViral-Work-Id": workId,
        },
        body: JSON.stringify({ ...comp, tracts: [] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: { ok: boolean; errors: string[] };
      };
      expect(body.result.ok).toBe(false);
      expect(body.result.errors.some((e) => e.includes("tracts"))).toBe(true);
      expect(await readFile(target, "utf8")).toBe(before);
      expect(events).not.toContain("composition-changed");
    } finally {
      off();
    }
  });

  it("POST /comp/validate without the work-id header → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/comp/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  it("PUT /comp?dry-run=true previews WITHOUT writing disk or broadcasting", async () => {
    const { readFile } = await import("node:fs/promises");
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const comp = await currentComp();
      const res = await app.request("/api/bridge/v1/comp?dry-run=true", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-AutoViral-Work-Id": workId,
        },
        body: JSON.stringify({ ...comp, duration: 321 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        result: { ok: boolean; errors: string[]; warnings: string[] };
      };
      expect(body.result.ok).toBe(true);
      // Disk byte-for-byte unchanged.
      expect(await readFile(target, "utf8")).toBe(before);
      // No broadcast on a dry-run.
      expect(events).not.toContain("composition-changed");
    } finally {
      off();
    }
  });

  it("PUT /comp?dry-run=true on an invalid composition → ok:false verdict, disk UNCHANGED, no broadcast", async () => {
    const { readFile } = await import("node:fs/promises");
    const target = join(workRoot, workId, "composition.yaml");
    const before = await readFile(target, "utf8");
    const events: string[] = [];
    const off = uiEventBus.subscribe(workId, (e) => events.push(e.type));
    try {
      const comp = await currentComp();
      const res = await app.request("/api/bridge/v1/comp?dry-run=true", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-AutoViral-Work-Id": workId,
        },
        body: JSON.stringify({ ...comp, tracks: "not-an-array" }),
      });
      // Dry-run is a successful preview REQUEST → 200 with a not-ok verdict.
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: { ok: boolean; errors: string[] };
      };
      expect(body.result.ok).toBe(false);
      expect(body.result.errors.length).toBeGreaterThan(0);
      expect(await readFile(target, "utf8")).toBe(before);
      expect(events).not.toContain("composition-changed");
    } finally {
      off();
    }
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

  // S8 fix-up — second prune failure mode through the full bridge round-trip:
  // moving the LAST clip (c2) makes c1 the new last clip of trk_v1; the seeded
  // transition pinned after c1 then has no successor. If the op did not prune
  // it, writeCompositionFor's CompositionWriteSchema.parse superRefine would
  // reject this VALID move with a 400. Asserting 200 + write-succeeds proves the
  // prune is complete. Uses its OWN isolated work-id (the describe block's other
  // tests mutate the shared YAML in order, so we seed a fresh fixture here to
  // stay order-independent).
  it("moves the last clip and prunes the now-last-clip orphan transition (no 400)", async () => {
    const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const isoWorkId = "w_move_last";
    const isoRoot = await mkdtemp(join(tmpdir(), "autoviral-move-last-"));
    await mkdir(join(isoRoot, isoWorkId), { recursive: true });
    const yaml = TWO_VIDEO_LANE_YAML.replace(/w_move/g, isoWorkId);
    await writeFile(join(isoRoot, isoWorkId, "composition.yaml"), yaml, "utf8");
    const prev = process.env.AUTOVIRAL_WORKS_ROOT;
    process.env.AUTOVIRAL_WORKS_ROOT = isoRoot;
    try {
      const res = await app.request(`/api/bridge/v1/clip/c2/move`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AutoViral-Work-Id": isoWorkId,
        },
        body: JSON.stringify({ toTrackId: "trk_v2" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        result?: { id: string };
      };
      expect(body.ok).toBe(true);
      expect(body.result?.id).toBe("c2");

      const comp = await app.request("/api/bridge/v1/comp", {
        headers: { "X-AutoViral-Work-Id": isoWorkId },
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
      // c1 is now the last clip on trk_v1; the transition pinned after it would
      // have no successor, so it must be pruned for the write to succeed.
      expect(v1.clips.map((c) => c.id)).toEqual(["c1"]);
      expect(v1.transitions ?? []).toHaveLength(0);
      const moved = v2.clips.find((c) => c.id === "c2");
      expect(moved).toBeDefined();
      expect(moved!.trackOffset).toBeCloseTo(4.0); // time position preserved
    } finally {
      if (prev === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
      else process.env.AUTOVIRAL_WORKS_ROOT = prev;
    }
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

// S10 (US 6/7/8) — track add/remove + clip add by trackId + overlay support.
describe("bridge router — S10 /track + clip trackId + overlay", () => {
  let workRoot: string;
  const workId = "w_track";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;

  // Two audio lanes (A1 with a clip, A2 empty) so we can prove trackId targeting
  // lands a voiceover on A2 rather than always hitting the first same-kind lane.
  const TWO_AUDIO_LANE_YAML = `id: c_${workId}
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
  - id: trk_a1
    kind: audio
    label: A1
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
  - id: trk_a2
    kind: audio
    label: A2
    muted: false
    hidden: false
    clips: []
assets: []
provenance: []
exportPresets: []
`;

  beforeAll(async () => {
    const { mkdtemp, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-track-route-"));
    await mkdir(join(workRoot, workId), { recursive: true });
    await writeFile(
      join(workRoot, workId, "composition.yaml"),
      TWO_AUDIO_LANE_YAML,
      "utf8",
    );
    process.env.AUTOVIRAL_WORKS_ROOT = workRoot;
  });
  afterAll(() => {
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
  });

  function getComp() {
    return app
      .request("/api/bridge/v1/comp", {
        headers: { "X-AutoViral-Work-Id": workId },
      })
      .then((r) => r.json()) as Promise<{
      result: {
        tracks: Array<{
          id: string;
          kind: string;
          label: string;
          clips: Array<{ id: string; kind: string }>;
        }>;
      };
    }>;
  }

  it("POST /track adds a new audio lane and echoes the minted trackId", async () => {
    const res = await app.request("/api/bridge/v1/track", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ kind: "audio" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result?: { trackId: string };
    };
    expect(body.ok).toBe(true);
    expect(body.result?.trackId).toMatch(/^trk_/);
    const comp = await getComp();
    expect(comp.result.tracks.some((t) => t.id === body.result!.trackId)).toBe(
      true,
    );
  });

  it("POST /clip with an explicit trackId lands the clip on THAT lane (A2, not A1)", async () => {
    const res = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/voiceover.mp3",
        track: "audio",
        trackId: "trk_a2",
        offset: 0,
        duration: 3,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { id: string } };
    expect(body.ok).toBe(true);
    const newId = body.result!.id;
    const comp = await getComp();
    const a1 = comp.result.tracks.find((t) => t.id === "trk_a1")!;
    const a2 = comp.result.tracks.find((t) => t.id === "trk_a2")!;
    expect(a2.clips.some((c) => c.id === newId)).toBe(true); // landed on A2
    expect(a1.clips.some((c) => c.id === newId)).toBe(false); // NOT on A1
  });

  it("POST /clip without trackId falls back to the FIRST same-kind lane (A1)", async () => {
    const res = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/extra-bgm.mp3",
        track: "audio",
        offset: 0,
        duration: 2,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { id: string } };
    const comp = await getComp();
    const a1 = comp.result.tracks.find((t) => t.id === "trk_a1")!;
    expect(a1.clips.some((c) => c.id === body.result.id)).toBe(true);
  });

  it("POST /clip with a trackId of the wrong kind → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/voiceover.mp3",
        track: "audio",
        trackId: "trk_v1", // video lane, not audio
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  // ── S10 fix-up (finding #1) — `duration` is a RELATIVE clip length, not an
  // absolute source `out`. `--in 2 --duration 3` must produce in=2 / out=5
  // (a 3-second clip), NOT in=2 / out=3 (a 1-second clip — the old bug).
  it("POST /clip video --in 2 --duration 3 → in=2 out=5 (3s clip, duration is relative)", async () => {
    const res = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/sample-shot.mp4",
        track: "video",
        trackId: "trk_v1",
        in: 2,
        duration: 3,
      }),
    });
    expect(res.status).toBe(200);
    const id = ((await res.json()) as { result: { id: string } }).result.id;
    const comp = await getComp();
    const clip = comp.result.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === id) as
      | { in: number; out: number }
      | undefined;
    expect(clip?.in).toBe(2);
    expect(clip?.out).toBe(5); // in + duration, NOT duration-as-out
  });

  it("POST /clip video --duration 3 (no --in) → in=0 out=3", async () => {
    const res = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/sample-shot.mp4",
        track: "video",
        trackId: "trk_v1",
        duration: 3,
      }),
    });
    expect(res.status).toBe(200);
    const id = ((await res.json()) as { result: { id: string } }).result.id;
    const comp = await getComp();
    const clip = comp.result.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === id) as
      | { in: number; out: number }
      | undefined;
    expect(clip?.in).toBe(0);
    expect(clip?.out).toBe(3);
  });

  it("POST /clip video --out 5 (explicit out wins over duration semantics)", async () => {
    const res = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/sample-shot.mp4",
        track: "video",
        trackId: "trk_v1",
        out: 5,
      }),
    });
    expect(res.status).toBe(200);
    const id = ((await res.json()) as { result: { id: string } }).result.id;
    const comp = await getComp();
    const clip = comp.result.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === id) as
      | { in: number; out: number }
      | undefined;
    expect(clip?.in).toBe(0);
    expect(clip?.out).toBe(5);
  });

  it("POST /clip audio --in 2 --duration 3 → in=2 out=5 (same relative-duration semantics)", async () => {
    const res = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/sample-bgm.mp3",
        track: "audio",
        trackId: "trk_a2",
        in: 2,
        duration: 3,
      }),
    });
    expect(res.status).toBe(200);
    const id = ((await res.json()) as { result: { id: string } }).result.id;
    const comp = await getComp();
    const clip = comp.result.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === id) as
      | { in: number; out: number }
      | undefined;
    expect(clip?.in).toBe(2);
    expect(clip?.out).toBe(5);
  });

  // ── S10 fix-up (finding #2) — an unknown `--track` kind must be an explicit
  // 400 + code:4 rejection, NOT silently interpreted as an overlay clip (the
  // `else` branch is reached ONLY for a genuine "overlay" value now).
  it("POST /clip --track foo → 400 + code 4, disk untouched", async () => {
    const before = await getComp();
    const beforeCount = before.result.tracks.reduce(
      (n, t) => n + t.clips.length,
      0,
    );
    const res = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/logo.png",
        track: "foo",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number; error?: string };
    expect(body.code).toBe(4);
    expect(body.error).toMatch(/invalid track kind/);
    // Disk untouched: no overlay (or any) clip silently appended.
    const after = await getComp();
    const afterCount = after.result.tracks.reduce(
      (n, t) => n + t.clips.length,
      0,
    );
    expect(afterCount).toBe(beforeCount);
    // And specifically no clip got smuggled in as an overlay.
    const anyOverlayClip = after.result.tracks.some((t) =>
      t.clips.some((c) => c.kind === "overlay"),
    );
    expect(anyOverlayClip).toBe(false);
  });

  it("POST /clip on an overlay lane succeeds (no more hard-reject)", async () => {
    // First mint an overlay lane via POST /track, then add an overlay clip to it.
    const trackRes = await app.request("/api/bridge/v1/track", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ kind: "overlay" }),
    });
    const overlayTrackId = (
      (await trackRes.json()) as { result: { trackId: string } }
    ).result.trackId;

    const res = await app.request("/api/bridge/v1/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({
        src: "assets/logo.png",
        track: "overlay",
        trackId: overlayTrackId,
        offset: 1,
        duration: 4,
      }),
    });
    expect(res.status).toBe(200); // NOT the old 400 "overlay not supported"
    const body = (await res.json()) as { ok: boolean; result?: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.result?.id).toMatch(/^oc_/);
    const comp = await getComp();
    const overlayLane = comp.result.tracks.find((t) => t.id === overlayTrackId)!;
    const overlayClip = overlayLane.clips.find(
      (c) => c.id === body.result!.id,
    )!;
    expect(overlayClip.kind).toBe("overlay"); // real overlay clip persisted
  });

  it("DELETE /track/:id removes the lane", async () => {
    // Add a throwaway lane, then delete it.
    const add = await app.request("/api/bridge/v1/track", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ kind: "text", label: "scratch" }),
    });
    const trackId = ((await add.json()) as { result: { trackId: string } })
      .result.trackId;
    const del = await app.request(`/api/bridge/v1/track/${trackId}`, {
      method: "DELETE",
      headers: { "X-AutoViral-Work-Id": workId },
    });
    expect(del.status).toBe(200);
    const comp = await getComp();
    expect(comp.result.tracks.some((t) => t.id === trackId)).toBe(false);
  });

  it("DELETE /track/:id with an unknown id → 400 + code 4", async () => {
    const del = await app.request("/api/bridge/v1/track/trk_nope", {
      method: "DELETE",
      headers: { "X-AutoViral-Work-Id": workId },
    });
    expect(del.status).toBe(400);
    const body = (await del.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /track with an invalid kind → 400 + code 4", async () => {
    const res = await app.request("/api/bridge/v1/track", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AutoViral-Work-Id": workId,
      },
      body: JSON.stringify({ kind: "bogus" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: number };
    expect(body.code).toBe(4);
  });

  it("POST /track without a work-id header → 400", async () => {
    const res = await app.request("/api/bridge/v1/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "audio" }),
    });
    expect(res.status).toBe(400);
  });
});

// S14 (US 20/21) — ASR caption generate. The bridge runs the (mocked) ASR core
// and writes its segments as TextClips into the text track, atomically +
// broadcasting composition-changed. Seeded from sample-work each block.
describe("bridge router — Phase 3 captions generate (S14)", () => {
  let workRoot: string;
  const workId = "w_captions";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;
  const mockAsr = vi.mocked(runAsrCaptions);

  beforeAll(async () => {
    const { mkdtemp, readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-captions-route-"));
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

  async function trackIdOfKind(kind: string): Promise<string> {
    // Legacy semantic ids (`text-0` / `audio-0`) are migrated to random `trk_`
    // ids on read (#31/#57), so a literal id won't match — look the real one up.
    const res = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const body = (await res.json()) as {
      result: { tracks: Array<{ id: string; kind: string }> };
    };
    const t = body.result.tracks.find((tr) => tr.kind === kind);
    if (!t) throw new Error(`no ${kind} track in fixture`);
    return t.id;
  }

  async function textClips() {
    const res = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const body = (await res.json()) as {
      result: { tracks: Array<{ kind: string; clips: Array<{ kind: string; text?: string; trackOffset: number; duration: number }> }> };
    };
    return body.result.tracks
      .filter((t) => t.kind === "text")
      .flatMap((t) => t.clips)
      .filter((cl) => cl.kind === "text");
  }

  it("runs ASR on the first audio clip + writes each segment as a text clip", async () => {
    mockAsr.mockResolvedValueOnce({
      ok: true,
      captions: [
        { start: 0, end: 1.5, text: "你好世界" },
        { start: 1.5, end: 3.0, text: "second line" },
      ],
    });
    const before = (await textClips()).length;

    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ language: "zh" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { written: number } };
    expect(body.ok).toBe(true);
    expect(body.result?.written).toBe(2);

    // ASR ran against the first audio clip's src (assets/sample-bgm.mp3), abs path.
    expect(mockAsr).toHaveBeenCalledWith(
      expect.stringContaining("assets/sample-bgm.mp3"),
      "zh",
    );

    const after = await textClips();
    expect(after.length).toBe(before + 2);
    const texts = after.map((c) => c.text);
    expect(texts).toContain("你好世界");
    expect(texts).toContain("second line");
    // Timecodes landed: the second segment is trackOffset 1.5, duration 1.5.
    const second = after.find((c) => c.text === "second line")!;
    expect(second.trackOffset).toBeCloseTo(1.5);
    expect(second.duration).toBeCloseTo(1.5);
  });

  it("broadcasts composition-changed after the write lands", async () => {
    mockAsr.mockResolvedValueOnce({
      ok: true,
      captions: [{ start: 0, end: 1, text: "ping" }],
    });
    const events: unknown[] = [];
    const unsub = uiEventBus.subscribe(workId, (e) => events.push(e));
    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({}),
    });
    unsub();
    expect(res.status).toBe(200);
    expect(
      events.some(
        (e) =>
          (e as { type?: string }).type === "composition-changed" &&
          ((e as { payload?: { reason?: string } }).payload?.reason === "captions-generate"),
      ),
    ).toBe(true);
  });

  it("forwards a 503 PYTHON_DEP_MISSING from the ASR core verbatim", async () => {
    mockAsr.mockResolvedValueOnce({
      ok: false,
      status: 503,
      code: "PYTHON_DEP_MISSING",
      error: "stable-whisper not installed",
    });
    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; code?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("PYTHON_DEP_MISSING");
  });

  it("accepts an explicit --asset override (assetPath)", async () => {
    mockAsr.mockResolvedValueOnce({ ok: true, captions: [] });
    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ assetPath: "assets/voice.mp3" }),
    });
    expect(res.status).toBe(200);
    expect(mockAsr).toHaveBeenCalledWith(
      expect.stringContaining("assets/voice.mp3"),
      undefined,
    );
  });

  it("without a work-id header → 400", async () => {
    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  // Fix B.1 — path-traversal: a `assetPath` containing `../` must NOT be allowed
  // to resolve to a file OUTSIDE the work dir. Before the fix the route did a bare
  // `join(worksRoot, workId, src)` and handed the escaped path straight to ASR.
  it("rejects an assetPath that escapes the work dir with ../ → 400 code:4", async () => {
    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ assetPath: "../../../etc/passwd" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
    // The ASR core must never have been invoked with an out-of-work path.
    for (const call of mockAsr.mock.calls) {
      expect(call[0]).not.toContain("etc/passwd");
    }
  });

  it("rejects an absolute assetPath outside the work dir → 400 code:4", async () => {
    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ assetPath: "/etc/passwd" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  // Fix B.4 — explicit trackId target: write into the named text lane, and reject
  // a non-text lane.
  it("writes captions into an explicit text trackId when given", async () => {
    mockAsr.mockResolvedValueOnce({
      ok: true,
      captions: [{ start: 0, end: 1, text: "targeted" }],
    });
    const textId = await trackIdOfKind("text");
    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ trackId: textId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { written: number } };
    expect(body.ok).toBe(true);
    expect(body.result?.written).toBe(1);
    const after = await textClips();
    expect(after.map((c) => c.text)).toContain("targeted");
  });

  it("rejects an explicit trackId that is not a text lane → 400 code:4", async () => {
    mockAsr.mockResolvedValueOnce({
      ok: true,
      captions: [{ start: 0, end: 1, text: "nope" }],
    });
    const audioId = await trackIdOfKind("audio");
    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ trackId: audioId }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number; error?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
    expect(body.error).toMatch(new RegExp(audioId));
  });

  it("rejects an explicit trackId that does not exist → 400 code:4", async () => {
    mockAsr.mockResolvedValueOnce({
      ok: true,
      captions: [{ start: 0, end: 1, text: "nope" }],
    });
    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ trackId: "trk_does_not_exist" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
  });

  // Fix B.3 — zero-segment ASR (silence / no speech) must NOT look like a
  // silent success: surface an explicit `message` so the agent / UI knows
  // nothing was written.
  it("returns an explicit no-speech message when ASR finds zero segments", async () => {
    mockAsr.mockResolvedValueOnce({ ok: true, captions: [] });
    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result?: { written: number; message?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.result?.written).toBe(0);
    expect(body.result?.message).toMatch(/no speech/i);
  });
});

// Fix B.2 — captions generate on a work that has NO text track yet (the most
// common entry point: a freshly created video work). The route must auto-create
// a text lane (via the shared addTrack op) and land the caption clips there,
// instead of hard-400ing "No text track to write captions into".
describe("bridge router — captions generate auto-creates a text track (Fix B.2)", () => {
  let workRoot: string;
  const workId = "w_captions_notext";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;
  const mockAsr = vi.mocked(runAsrCaptions);

  beforeAll(async () => {
    const { mkdtemp, readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-captions-notext-"));
    const fixture = await readFile(
      join(__dirname, "../../../../tests/fixtures/sample-work/composition.yaml"),
      "utf8",
    );
    // Strip the `text-0` track (its block runs from `- id: text-0` up to the
    // `assets:` line) so the seeded work has video + audio lanes but NO text lane.
    const withoutText = fixture
      .replace(/workId: sample-work/, `workId: ${workId}`)
      .replace(/  - id: text-0[\s\S]*?(?=assets:)/, "");
    await mkdir(join(workRoot, workId), { recursive: true });
    await writeFile(join(workRoot, workId, "composition.yaml"), withoutText, "utf8");
    process.env.AUTOVIRAL_WORKS_ROOT = workRoot;
  });
  afterAll(() => {
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
  });

  it("auto-creates a text lane and writes the caption clips there (no 400)", async () => {
    mockAsr.mockResolvedValueOnce({
      ok: true,
      captions: [{ start: 0, end: 1.2, text: "first caption" }],
    });

    // Sanity: the seeded work really has no text lane.
    const before = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const beforeBody = (await before.json()) as {
      result: { tracks: Array<{ kind: string }> };
    };
    expect(beforeBody.result.tracks.some((t) => t.kind === "text")).toBe(false);

    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ language: "en" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { written: number } };
    expect(body.ok).toBe(true);
    expect(body.result?.written).toBe(1);

    const after = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const afterBody = (await after.json()) as {
      result: { tracks: Array<{ kind: string; clips: Array<{ kind: string; text?: string }> }> };
    };
    const textTracks = afterBody.result.tracks.filter((t) => t.kind === "text");
    expect(textTracks.length).toBe(1);
    const texts = textTracks.flatMap((t) => t.clips).map((c) => c.text);
    expect(texts).toContain("first caption");
  });
});

// E2E regression (2026-06-05) — the default (no --asset) captions entry point
// must work for a REAL work, whose audio clip stores its `src` as a SERVED-URL
// (`/api/works/<id>/assets/music/bgm.mp3`, leading slash + encoded segments),
// NOT the bare relative form the older fixture used. Before the fix the route
// did `resolve(workDir, "/api/works/...")` → the leading slash made it ABSOLUTE
// and land outside the work dir → path-traversal guard rejected the default
// "生成字幕" button for every real work (400 code:4). The fix strips the
// served-URL prefix back to bare-relative before resolving, while a malicious
// `../`-laden served-URL is STILL caught by the guard.
describe("bridge router — captions generate, real served-URL audio src (E2E regression)", () => {
  let workRoot: string;
  const workId = "w_captions_servedurl";
  const prevWorksRoot = process.env.AUTOVIRAL_WORKS_ROOT;
  const mockAsr = vi.mocked(runAsrCaptions);

  beforeAll(async () => {
    const { mkdtemp, readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    workRoot = await mkdtemp(join(tmpdir(), "autoviral-captions-servedurl-"));
    const fixture = await readFile(
      join(__dirname, "../../../../tests/fixtures/sample-work/composition.yaml"),
      "utf8",
    );
    // Rewrite the audio clip src to the REAL studio-persisted shape: a
    // page-absolute served-URL with the `/api/works/<id>/assets/` prefix and a
    // nested subdir, exactly what the preview Player loads.
    const realShape = fixture
      .replace(/workId: sample-work/, `workId: ${workId}`)
      .replace(
        /src: assets\/sample-bgm\.mp3/,
        `src: /api/works/${workId}/assets/music/bgm.mp3`,
      );
    await mkdir(join(workRoot, workId), { recursive: true });
    await writeFile(join(workRoot, workId, "composition.yaml"), realShape, "utf8");
    process.env.AUTOVIRAL_WORKS_ROOT = workRoot;
  });
  afterAll(() => {
    if (prevWorksRoot === undefined) delete process.env.AUTOVIRAL_WORKS_ROOT;
    else process.env.AUTOVIRAL_WORKS_ROOT = prevWorksRoot;
  });

  it("DEFAULT src (no --asset) resolves a served-URL audio clip → 200 + writes captions", async () => {
    mockAsr.mockResolvedValueOnce({
      ok: true,
      captions: [{ start: 0, end: 1.2, text: "real served url caption" }],
    });
    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({ language: "zh" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { written: number } };
    expect(body.ok).toBe(true);
    expect(body.result?.written).toBe(1);

    // ASR ran against the on-disk file the served-URL points at — the prefix
    // was stripped back to a bare-relative path under the work dir, NOT the
    // literal `/api/works/...` URL (which would have escaped the work dir).
    expect(mockAsr).toHaveBeenCalledWith(
      expect.stringContaining(join("music", "bgm.mp3")),
      "zh",
    );
    const calledWith = mockAsr.mock.calls.at(-1)?.[0] as string;
    expect(calledWith).not.toContain("/api/works/");

    const comp = await app.request("/api/bridge/v1/comp", {
      headers: { "X-AutoViral-Work-Id": workId },
    });
    const compBody = (await comp.json()) as {
      result: { tracks: Array<{ kind: string; clips: Array<{ text?: string }> }> };
    };
    const texts = compBody.result.tracks
      .filter((t) => t.kind === "text")
      .flatMap((t) => t.clips)
      .map((c) => c.text);
    expect(texts).toContain("real served url caption");
  });

  // Security: a served-URL-SHAPED src that smuggles `../` segments must still be
  // rejected after prefix-stripping (the bare-relative `../../../etc/passwd`
  // escapes the work dir). The fix must not weaken the S14 traversal guard.
  it("rejects a malicious ../-laden assetPath (served-URL shaped) → 400 code:4", async () => {
    const res = await app.request("/api/bridge/v1/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AutoViral-Work-Id": workId },
      body: JSON.stringify({
        assetPath: `/api/works/${workId}/assets/../../../etc/passwd`,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code?: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe(4);
    for (const call of mockAsr.mock.calls) {
      expect(call[0]).not.toContain("etc/passwd");
    }
  });
});

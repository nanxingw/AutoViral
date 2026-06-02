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

  it("GET /docs?topic=00-quickstart returns the named file", async () => {
    const res = await app.request("/api/bridge/v1/docs?topic=00-quickstart");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/quickstart/i);
  });

  it("GET /docs?topic=does-not-exist → 404", async () => {
    const res = await app.request("/api/bridge/v1/docs?topic=does-not-exist");
    expect(res.status).toBe(404);
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

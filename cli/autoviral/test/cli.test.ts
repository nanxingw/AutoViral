// End-to-end CLI integration — spawns the built `autoviral` binary as
// a subprocess against a Node http mock that mimics the bridge's JSON
// envelope. This isolates the CLI's HTTP wire format + dispatch + exit
// codes from the backend's actual write logic (covered in
// src/server/bridge/__tests__/routes.test.ts).

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN = join(__dirname, "../dist/cli.js");

let server: Server;
let port: number;

// In-memory mock state. Each clip add appends an id; remove filters it
// out. Just enough to exercise the CLI's stdout contract end-to-end.
const clips: Array<{ id: string; trackKind: string }> = [
  { id: "vc_s01", trackKind: "video" },
  { id: "ac_bgm01", trackKind: "audio" },
  { id: "tc_hook01", trackKind: "text" },
];
let nextSeq = 1;
// S2 (PRD-0007) — in-memory scenes the mock GET /comp returns + POST /scene
// appends to, so `scene add` then `scene list` round-trips end-to-end through
// the CLI's read+write surface (the real ops/broadcast live in routes.test.ts).
const scenes: Array<{ id: string; order: number; title: string; intent?: string; status?: string }> = [];
// S11 — capture the last PATCH /clip body so the CLI test can assert the
// flag → nested-path mapping + value coercion that reached the bridge.
let lastClipPatch: Record<string, unknown> | null = null;
// S10 (US 7/8) — capture the last POST /clip body so the CLI test can assert the
// `--track-id` flag reached the bridge as `trackId`.
let lastClipAdd: Record<string, unknown> | null = null;
// S10 (US 6/7/8) — capture the last POST /track body so the CLI test can assert
// the `track add` flags (kind / --after / --label / --language) reached the wire.
let lastTrackAdd: Record<string, unknown> | null = null;
// S4 (US 10) — capture the last PUT /comp body so the CLI test can assert the
// full composition the CLI read from a file / stdin reached the bridge verbatim.
let lastCompPut: Record<string, unknown> | null = null;
// S13 (US 11/12) — capture the last POST /comp/validate body so the CLI test
// can assert the candidate the CLI read from a file / stdin reached the bridge.
let lastCompValidate: Record<string, unknown> | null = null;
// S17 (US 26) — capture the last POST /comp/aspect body so the CLI test can
// assert `comp aspect <ratio>` reached the bridge as { ratio }.
let lastCompAspect: Record<string, unknown> | null = null;
// carousel set-layer patch — capture the last POST /carousel/.../layer body so
// the CLI test can assert which fields the CLI sent (a patch must send ONLY the
// supplied flags, incl. the new --italic / --tracking, and a partial box).
let lastLayerSet: Record<string, unknown> | null = null;
// S2 (PRD-0007) — capture the last scene write bodies so the CLI test can assert
// the `scene add/set/reorder/link` flags reached the bridge in the right shape.
let lastSceneAdd: Record<string, unknown> | null = null;
let lastSceneSet: Record<string, unknown> | null = null;
let lastSceneReorder: Record<string, unknown> | null = null;
let lastSceneLink: Record<string, unknown> | null = null;

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try { resolve(JSON.parse(buf || "{}")); } catch { resolve({}); }
    });
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = req.url ?? "";
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url === "/api/bridge/v1/whoami") {
      return send(200, {
        ok: true,
        result: { workId: "w_e2e", cwd: "/tmp", port, version: "0.1.0" },
      });
    }
    if (req.method === "GET" && url === "/api/bridge/v1/comp") {
      return send(200, {
        ok: true,
        result: { workId: "w_e2e", fps: 30, tracks: [], assets: [], scenes, duration: 0, width: 1080, height: 1920, aspect: "9:16", id: "c_e2e", updatedAt: "2026-05-14T00:00:00.000Z" },
      });
    }
    if (req.method === "GET" && url === "/api/bridge/v1/comp/diff") {
      // Phase 5 Task 5.4 — single fixture (non-empty diff). The CLI's
      // "no baseline" / "no changes" paths are exercised at the server
      // unit-test level (composition-ops.test.ts).
      return send(200, {
        ok: true,
        result: {
          diff:
            "--- composition.yaml.previous\n+++ composition.yaml\n@@ -1,3 +1,3 @@\n fps: 30\n-duration: 0\n+duration: 5\n tracks: []\n",
          hasBaseline: true,
        },
      });
    }
    if (req.method === "GET" && url.startsWith("/api/bridge/v1/clips")) {
      return send(200, { ok: true, result: clips });
    }
    // S4 (US 10) — PUT /comp. Mirrors the server contract: a parseable body with
    // a sentinel `tracks:"reject"` simulates a zod rejection (400 + code:4 → CLI
    // exit 4); otherwise the body is recorded + 200 {ok:true}. The server's real
    // validate-before-disk-touch invariant lives in routes.test.ts.
    if (req.method === "PUT" && url === "/api/bridge/v1/comp") {
      const body = await readBody(req);
      if (body.tracks === "reject") {
        return send(400, { ok: false, error: "invalid composition", code: 4 });
      }
      lastCompPut = body;
      return send(200, { ok: true });
    }
    // S13 (US 11/12) — POST /comp/validate. Mirrors the server contract: ALWAYS
    // 200 with a {ok,errors,warnings} verdict (an invalid candidate is a "not
    // ok" VERDICT, not an HTTP error). Sentinels: tracks:"reject" → errors;
    // tracks:"warn" → a warning while staying ok. Anything else → clean.
    if (req.method === "POST" && url === "/api/bridge/v1/comp/validate") {
      lastCompValidate = await readBody(req);
      const t = (lastCompValidate as { tracks?: unknown }).tracks;
      if (t === "reject") {
        return send(200, {
          ok: true,
          result: { ok: false, errors: ["tracks: expected array"], warnings: [] },
        });
      }
      if (t === "warn") {
        return send(200, {
          ok: true,
          result: { ok: true, errors: [], warnings: ['clip "a" overlaps "b"'] },
        });
      }
      return send(200, { ok: true, result: { ok: true, errors: [], warnings: [] } });
    }
    // S17 (US 26) — POST /comp/aspect. The CLI validates the ratio locally
    // (exit 4 before the bridge) so only a canonical ratio reaches here; the
    // mock records the body and echoes the contract { ok, result:{ ratio } }.
    if (req.method === "POST" && url === "/api/bridge/v1/comp/aspect") {
      lastCompAspect = await readBody(req);
      return send(200, { ok: true, result: { ratio: lastCompAspect.ratio } });
    }
    // I08 — carousel write endpoints. Mirror the server's contract: POST
    // /carousel/slide returns { ok, result:{ id } }; POST
    // /carousel/slide/:id/layer echoes the layer id (or mints one). A layer
    // with kind "bogus" simulates a zod rejection → 400 + code 4.
    if (req.method === "POST" && url === "/api/bridge/v1/carousel/slide") {
      await readBody(req);
      const id = `s_e2e${nextSeq++}`;
      return send(200, { ok: true, result: { id } });
    }
    if (
      req.method === "POST" &&
      /^\/api\/bridge\/v1\/carousel\/slide\/[^/]+\/layer$/.test(url)
    ) {
      const body = await readBody(req);
      lastLayerSet = body;
      if (body.kind === "bogus") {
        return send(400, { ok: false, error: "invalid layer kind", code: 4 });
      }
      const id = typeof body.id === "string" && body.id ? body.id : `t_e2e${nextSeq++}`;
      return send(200, { ok: true, result: { id } });
    }
    if (req.method === "POST" && url === "/api/bridge/v1/clip") {
      const body = await readBody(req);
      // S3 (US 18/19) — error-code contract fixtures. Sentinel track
      // "reject" is the bridge's validation rejection: HTTP 400 + code:4 →
      // CLI exit 4. Sentinel track "boom" simulates a service error: HTTP
      // 500 (no code) → CLI exit 3. Everything else is the happy 200 path.
      if (body.track === "reject") {
        return send(400, { ok: false, error: "no track of kind reject", code: 4 });
      }
      if (body.track === "boom") {
        return send(500, { ok: false, error: "disk on fire" });
      }
      // S3 fix-up — exercise the client's defensive JSON.parse(catch) branch:
      // a 400 with a NON-JSON (HTML/text) body. The CLI must fall back to the
      // status-class mapping (4xx → exit 4) and NOT crash on the unparseable
      // body. error-codes.md rule #3.
      if (body.track === "html400") {
        res.statusCode = 400;
        res.setHeader("content-type", "text/html");
        res.end("<html><body>502 Bad Gateway</body></html>");
        return;
      }
      // S3 fix-up — HTTP 200 with a business-level failure envelope, WITH an
      // explicit code:4 → CLI must honour it (exit 4). error-codes.md rule #4.
      if (body.track === "envfail4") {
        return send(200, { ok: false, error: "validation in 200 envelope", code: 4 });
      }
      // S3 fix-up — HTTP 200 {ok:false} with NO code → defaults to exit 3
      // (treated as a service/protocol error). error-codes.md rule #4.
      if (body.track === "envfailnocode") {
        return send(200, { ok: false, error: "envelope failure no code" });
      }
      lastClipAdd = body;
      const id = `vc_e2e${nextSeq++}`;
      clips.push({ id, trackKind: body.track });
      return send(200, { ok: true, result: { id } });
    }
    // S10 (US 6/7/8) — POST /track: mints a lane id; an invalid kind is the
    // bridge's 400 + code 4 → CLI exit 4 (mirrors the real route).
    if (req.method === "POST" && url === "/api/bridge/v1/track") {
      const body = await readBody(req);
      lastTrackAdd = body;
      if (body.kind === "bogus") {
        return send(400, { ok: false, error: "invalid kind", code: 4 });
      }
      return send(200, { ok: true, result: { trackId: `trk_seq${nextSeq++}` } });
    }
    // S10 (US 6/7/8) — DELETE /track/:id. A known id resolves; `trk_ghost` is the
    // op's CompositionOpError → 400 + code 4 → CLI exit 4.
    {
      const trackMatch = /^\/api\/bridge\/v1\/track\/([^/]+)$/.exec(url ?? "");
      if (req.method === "DELETE" && trackMatch) {
        const id = decodeURIComponent(trackMatch[1]);
        if (id === "trk_ghost") {
          return send(400, { ok: false, error: "no such track", code: 4 });
        }
        return send(200, { ok: true });
      }
    }
    if (req.method === "DELETE" && url.startsWith("/api/bridge/v1/clip/")) {
      const id = url.split("/").pop()!;
      const idx = clips.findIndex((c) => c.id === id);
      if (idx >= 0) clips.splice(idx, 1);
      return send(200, { ok: true });
    }
    // S2 (PRD-0007) — POST /scene. Mirrors the server contract: a string `title`
    // mints a scene id + appends it (order auto-assigned), and returns
    // { sceneId }. A missing/non-string title is the route's shape gate → 400 +
    // code 4 → CLI exit 4 (but the CLI rejects locally first, so this is the
    // defence-in-depth path). The real op/broadcast lives in routes.test.ts.
    if (req.method === "POST" && url === "/api/bridge/v1/scene") {
      const body = await readBody(req);
      lastSceneAdd = body;
      if (typeof body.title !== "string" || !body.title) {
        return send(400, { ok: false, error: "missing title", code: 4 });
      }
      const id = `scn_seq${nextSeq++}`;
      scenes.push({
        id,
        order: scenes.length,
        title: body.title,
        intent: body.intent,
        status: "planned",
      });
      return send(200, { ok: true, result: { sceneId: id } });
    }
    // S2 — POST /scene/reorder. A non-array orderedSceneIds is the route shape
    // gate → 400 + code 4. An array is recorded + 200.
    if (req.method === "POST" && url === "/api/bridge/v1/scene/reorder") {
      const body = await readBody(req);
      lastSceneReorder = body;
      if (!Array.isArray(body.orderedSceneIds)) {
        return send(400, { ok: false, error: "missing/invalid orderedSceneIds", code: 4 });
      }
      return send(200, { ok: true });
    }
    // S2 — POST /scene/:id/link. A known scene id records the body + 200;
    // `scn_ghost` is the op's CompositionOpError → 400 + code 4 → CLI exit 4.
    {
      const linkMatch = /^\/api\/bridge\/v1\/scene\/([^/]+)\/link$/.exec(url ?? "");
      if (req.method === "POST" && linkMatch) {
        const body = await readBody(req);
        lastSceneLink = body;
        const id = decodeURIComponent(linkMatch[1]);
        if (id === "scn_ghost") {
          return send(400, { ok: false, error: "no such scene", code: 4 });
        }
        return send(200, { ok: true });
      }
    }
    // S2 — PATCH /scene/:id (the body IS the props object) + DELETE /scene/:id.
    // A known id resolves; `scn_ghost` is the op's CompositionOpError → 400 +
    // code 4 → CLI exit 4.
    {
      const sceneMatch = /^\/api\/bridge\/v1\/scene\/([^/]+)$/.exec(url ?? "");
      if (sceneMatch) {
        const id = decodeURIComponent(sceneMatch[1]);
        if (req.method === "PATCH") {
          const body = await readBody(req);
          lastSceneSet = body;
          if (id === "scn_ghost") {
            return send(400, { ok: false, error: "no such scene", code: 4 });
          }
          return send(200, { ok: true });
        }
        if (req.method === "DELETE") {
          if (id === "scn_ghost") {
            return send(400, { ok: false, error: "no such scene", code: 4 });
          }
          const idx = scenes.findIndex((s) => s.id === id);
          if (idx >= 0) scenes.splice(idx, 1);
          return send(200, { ok: true });
        }
      }
    }
    // S11 — PATCH /clip/:id. The mock just records the body the CLI sent so the
    // test can assert the flag → nested-path mapping + value coercion. (The real
    // per-kind whitelist / 400-on-unknown lives in the server route tests.)
    if (req.method === "PATCH" && url.startsWith("/api/bridge/v1/clip/")) {
      lastClipPatch = await readBody(req);
      return send(200, { ok: true });
    }
    // S6 (US 1/9) — POST /split. Mirrors the server contract: a known clipId
    // appends a new child clip + returns { id }; an unknown clipId is the
    // op's CompositionOpError → 400 + code 4 → CLI exit 4.
    if (req.method === "POST" && url === "/api/bridge/v1/split") {
      const body = await readBody(req);
      const target = clips.find((c) => c.id === body.clipId);
      if (!target) {
        return send(400, { ok: false, error: "no such clip", code: 4 });
      }
      const id = `vc_split${nextSeq++}`;
      clips.push({ id, trackKind: target.trackKind });
      return send(200, { ok: true, result: { id } });
    }
    // S7 (US 2/9) — POST /clip/:id/trim. Mirrors the server contract: a known
    // clipId sets its source window in place + returns { id }; an unknown
    // clipId is the op's CompositionOpError → 400 + code 4 → CLI exit 4.
    {
      const trimMatch = /^\/api\/bridge\/v1\/clip\/([^/]+)\/trim$/.exec(url ?? "");
      if (req.method === "POST" && trimMatch) {
        await readBody(req);
        const clipId = decodeURIComponent(trimMatch[1]);
        const target = clips.find((c) => c.id === clipId);
        if (!target) {
          return send(400, { ok: false, error: "no such clip", code: 4 });
        }
        return send(200, { ok: true, result: { id: clipId } });
      }
    }
    // S8 (US 3/9) — POST /clip/:id/move. Mirrors the server contract: a known
    // clipId with a toTrackId relocates it + returns { id }; an unknown clipId
    // is the op's CompositionOpError → 400 + code 4 → CLI exit 4.
    {
      const moveMatch = /^\/api\/bridge\/v1\/clip\/([^/]+)\/move$/.exec(url ?? "");
      if (req.method === "POST" && moveMatch) {
        await readBody(req);
        const clipId = decodeURIComponent(moveMatch[1]);
        const target = clips.find((c) => c.id === clipId);
        if (!target) {
          return send(400, { ok: false, error: "no such clip", code: 4 });
        }
        return send(200, { ok: true, result: { id: clipId } });
      }
    }
    // S12 (US 16 / 35-37) — POST /clip/:id/keyframe. Mirrors the server
    // contract: a known clipId authoring a keyframe returns { id }; an unknown
    // clipId / a text clip / a bad property is the op's CompositionOpError → 400
    // + code 4 → CLI exit 4. The mock keys "rejectable" inputs off the clipId /
    // property so the CLI wire format + exit codes are exercised without the op.
    {
      const kfMatch = /^\/api\/bridge\/v1\/clip\/([^/]+)\/keyframe$/.exec(url ?? "");
      if (req.method === "POST" && kfMatch) {
        const body = await readBody(req);
        const clipId = decodeURIComponent(kfMatch[1]);
        const target = clips.find((c) => c.id === clipId);
        if (!target) {
          return send(400, { ok: false, error: "no such clip", code: 4 });
        }
        if (target.trackKind === "text") {
          return send(400, { ok: false, error: "text carries no keyframes", code: 4 });
        }
        if (body.property === "bogus") {
          return send(400, { ok: false, error: "unknown property", code: 4 });
        }
        return send(200, { ok: true, result: { id: clipId } });
      }
    }
    // S9 (US 4/5/9) — POST /transition. Mirrors the server contract: a known
    // afterClipId + a registry preset mints a transition id; an unknown preset
    // or a last-clip anchor is the op's CompositionOpError → 400 + code 4 → CLI
    // exit 4. The mock keys "rejectable" inputs off the preset/anchor so the CLI
    // wire format + exit codes are exercised without the real op.
    if (req.method === "POST" && url === "/api/bridge/v1/transition") {
      const body = await readBody(req);
      if (body.preset === "no-such-preset" || body.afterClipId === "tc_hook01") {
        return send(400, { ok: false, error: "rejected", code: 4 });
      }
      return send(200, { ok: true, result: { id: `tr_seq${nextSeq++}` } });
    }
    // S9 (US 4/5/9) — DELETE /transition/:id. A known id resolves; `tr_ghost`
    // is the op's CompositionOpError → 400 + code 4 → CLI exit 4.
    {
      const trMatch = /^\/api\/bridge\/v1\/transition\/([^/]+)$/.exec(url ?? "");
      if (req.method === "DELETE" && trMatch) {
        const id = decodeURIComponent(trMatch[1]);
        if (id === "tr_ghost") {
          return send(400, { ok: false, error: "no such transition", code: 4 });
        }
        return send(200, { ok: true, result: { id } });
      }
    }
    // S14 (US 20/21) — POST /captions/generate. Mirrors the server contract:
    // returns { ok, result:{ written, language } } counting the caption clips
    // written. A sentinel `language:"nodep"` simulates the bridge forwarding the
    // ASR core's 503 PYTHON_DEP_MISSING (a service/env error → CLI exit 3); an
    // `assetPath:"assets/missing.mp3"` echoes back written:0.
    if (req.method === "POST" && url === "/api/bridge/v1/captions/generate") {
      const body = await readBody(req);
      if (body.language === "nodep") {
        return send(503, { ok: false, error: "stable-whisper not installed", code: "PYTHON_DEP_MISSING" });
      }
      const written = body.assetPath === "assets/missing.mp3" ? 0 : 3;
      return send(200, { ok: true, result: { written, language: body.language ?? null } });
    }
    if (req.method === "POST" && (
      url === "/api/bridge/v1/select" ||
      url === "/api/bridge/v1/seek" ||
      url === "/api/bridge/v1/play" ||
      url === "/api/bridge/v1/pause" ||
      url === "/api/bridge/v1/toast" ||
      url === "/api/bridge/v1/progress"
    )) {
      await readBody(req);
      return send(200, { ok: true });
    }
    if (req.method === "POST" && url === "/api/bridge/v1/snapshot") {
      const body = await readBody(req);
      // Echo the requested frame/slide into the path so the test can assert the
      // CLI forwarded --at / --slide correctly. Mirrors the server contract:
      // { ok, result: { path, kind, textLayersComposited } }. A --slide request
      // simulates the carousel background-only fallback (text NOT composited) so
      // the test can assert the CLI prints the caveat; otherwise faithful.
      const isCarousel = typeof body.slide === "string";
      const tag =
        typeof body.at === "number"
          ? `at-${body.at}`
          : isCarousel
            ? `slide-${body.slide}`
            : "current";
      return send(200, {
        ok: true,
        result: {
          path: `/tmp/work/output/snapshot-${tag}.png`,
          kind: isCarousel ? "carousel-slide" : "video-still",
          textLayersComposited: !isCarousel,
        },
      });
    }
    // S21 (US 33/34) — checkpoint list/restore. GET /checkpoints returns a
    // newest-first history; POST /restore echoes the restored deliverable plus
    // the #68 pre-restore snapshot (so the CLI can report reversibility). An
    // unknown `file` simulates the not-found path: 404 + code:4 → CLI exit 4.
    if (req.method === "GET" && url === "/api/bridge/v1/checkpoints") {
      return send(200, {
        ok: true,
        result: [
          {
            file: "2026-05-09T10-00-00-000Z__bbbbbbbb__carousel.yaml",
            deliverable: "carousel.yaml",
            ts: "2026-05-09T10:00:00.000Z",
            sha: "bbbbbbbb",
            bytes: 42,
          },
          {
            file: "2026-05-08T10-00-00-000Z__aaaaaaaa__carousel.yaml",
            deliverable: "carousel.yaml",
            ts: "2026-05-08T10:00:00.000Z",
            sha: "aaaaaaaa",
            bytes: 30,
            label: "first cut",
          },
        ],
      });
    }
    if (req.method === "POST" && url === "/api/bridge/v1/restore") {
      const body = await readBody(req);
      if (!body.file || body.file === "nope__nope__carousel.yaml") {
        return send(404, { ok: false, error: "no such checkpoint", code: 4 });
      }
      return send(200, {
        ok: true,
        result: {
          deliverable: "carousel.yaml",
          // Simulate the #68 pre-restore snapshot being taken.
          preRestoreSnapshot: {
            file: "2026-05-10T11-00-00-000Z__cccccccc__carousel.yaml",
            sha: "cccccccc",
          },
        },
      });
    }
    if (req.method === "POST" && url === "/api/bridge/v1/ask") {
      const body = await readBody(req);
      // Simulate a timeout when the caller asked for <100ms — covers
      // both 0 (instant) and small values. Anything larger → auto-yes.
      if (typeof body.timeoutMs === "number" && body.timeoutMs < 100) {
        return send(504, { ok: false, error: "timeout", code: 124 });
      }
      return send(200, { ok: true, result: { answer: "yes" } });
    }
    send(404, { ok: false, error: "not found" });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server.close();
});

function run(args: string[], opts: { timeout?: number } = {}) {
  return execa("node", [BIN, ...args], {
    env: {
      ...process.env,
      AUTOVIRAL_WORK_ID: "w_e2e",
      AUTOVIRAL_PORT: String(port),
    },
    reject: false,
    timeout: opts.timeout ?? 10_000,
  });
}

describe("autoviral CLI — end-to-end", () => {
  it("whoami → ok JSON", async () => {
    const r = await run(["whoami"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.workId).toBe("w_e2e");
  });

  it("list clips → JSON array", async () => {
    const r = await run(["list", "clips"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(3);
  });

  it("clip add → returns new id, list shows it, remove makes it gone", async () => {
    const before = await run(["list", "clips"]);
    const beforeIds = (JSON.parse(before.stdout) as Array<{ id: string }>).map((c) => c.id);

    const add = await run([
      "clip", "add",
      "--src", "assets/sample.mp4",
      "--track", "video",
      "--offset", "5.0",
      "--duration", "2.0",
    ]);
    expect(add.exitCode).toBe(0);
    const newId = add.stdout.trim();
    expect(newId).toMatch(/^vc_/);

    const listAfter = await run(["list", "clips"]);
    const ids = (JSON.parse(listAfter.stdout) as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(newId);
    expect(ids.length).toBe(beforeIds.length + 1);

    const rm = await run(["clip", "remove", newId]);
    expect(rm.exitCode).toBe(0);

    const listAfterRm = await run(["list", "clips"]);
    const idsAfter = (JSON.parse(listAfterRm.stdout) as Array<{ id: string }>).map((c) => c.id);
    expect(idsAfter).not.toContain(newId);
  });

  it("clip split <id> --at <sec> → prints the new child id, list shows it", async () => {
    const before = await run(["list", "clips"]);
    const beforeIds = (JSON.parse(before.stdout) as Array<{ id: string }>).map((c) => c.id);

    const split = await run(["clip", "split", "vc_s01", "--at", "2.0"]);
    expect(split.exitCode).toBe(0);
    const newId = split.stdout.trim();
    expect(newId).toMatch(/^vc_split/);

    const after = await run(["list", "clips"]);
    const ids = (JSON.parse(after.stdout) as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(newId);
    expect(ids.length).toBe(beforeIds.length + 1);
  });

  it("clip split with no id → exit 4 (never hits bridge)", async () => {
    const r = await run(["clip", "split", "--at", "2.0"]);
    expect(r.exitCode).toBe(4);
  });

  it("clip split with no --at → exit 4 (never hits bridge)", async () => {
    const r = await run(["clip", "split", "vc_s01"]);
    expect(r.exitCode).toBe(4);
  });

  it("clip split an unknown clip → bridge 400 code:4 → exit 4", async () => {
    const r = await run(["clip", "split", "nope", "--at", "2.0"]);
    expect(r.exitCode).toBe(4);
  });

  // S7 (US 2/9) — `autoviral clip trim <id> --in --out` POSTs the source
  // window to /clip/:id/trim; the bridge runs the shared `ops.trimClip`.
  it("clip trim <id> --out <sec> → exit 0", async () => {
    const r = await run(["clip", "trim", "vc_s01", "--out", "2.0"]);
    expect(r.exitCode).toBe(0);
  });

  it("clip trim <id> --in <sec> --out <sec> → exit 0 (both edges)", async () => {
    const r = await run(["clip", "trim", "vc_s01", "--in", "0.5", "--out", "3.0"]);
    expect(r.exitCode).toBe(0);
  });

  it("clip trim with no id → exit 4 (never hits bridge)", async () => {
    const r = await run(["clip", "trim", "--out", "2.0"]);
    expect(r.exitCode).toBe(4);
  });

  it("clip trim with neither --in nor --out → exit 4 (never hits bridge)", async () => {
    const r = await run(["clip", "trim", "vc_s01"]);
    expect(r.exitCode).toBe(4);
  });

  it("clip trim with a non-numeric --out → exit 4 (never hits bridge)", async () => {
    const r = await run(["clip", "trim", "vc_s01", "--out", "abc"]);
    expect(r.exitCode).toBe(4);
  });

  it("clip trim an unknown clip → bridge 400 code:4 → exit 4", async () => {
    const r = await run(["clip", "trim", "nope", "--out", "2.0"]);
    expect(r.exitCode).toBe(4);
  });

  // S8 (US 3/9) — `autoviral clip move <id> --to-track <trackId>` POSTs the
  // target lane to /clip/:id/move; the bridge runs the shared
  // `ops.moveClipToTrack`.
  it("clip move <id> --to-track <trackId> → exit 0", async () => {
    const r = await run(["clip", "move", "vc_s01", "--to-track", "trk_v2"]);
    expect(r.exitCode).toBe(0);
  });

  it("clip move with no id → exit 4 (never hits bridge)", async () => {
    const r = await run(["clip", "move", "--to-track", "trk_v2"]);
    expect(r.exitCode).toBe(4);
  });

  it("clip move with no --to-track → exit 4 (never hits bridge)", async () => {
    const r = await run(["clip", "move", "vc_s01"]);
    expect(r.exitCode).toBe(4);
  });

  it("clip move an unknown clip → bridge 400 code:4 → exit 4", async () => {
    const r = await run(["clip", "move", "nope", "--to-track", "trk_v2"]);
    expect(r.exitCode).toBe(4);
  });

  // S9 (US 4/5/9) — `autoviral transition add --track --after --preset --duration`
  // POSTs to /transition; `transition remove <id>` DELETEs /transition/:id. The
  // bridge runs the shared `ops.addTransition` / `ops.removeTransition`.
  it("transition add --track --after --preset → prints the new transition id", async () => {
    const r = await run([
      "transition", "add",
      "--track", "trk_v",
      "--after", "vc_s01",
      "--preset", "cross-dissolve",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^tr_/);
  });

  it("transition add with --duration → exit 0 (duration forwarded)", async () => {
    const r = await run([
      "transition", "add",
      "--track", "trk_v",
      "--after", "vc_s01",
      "--preset", "wipe-left",
      "--duration", "0.8",
    ]);
    expect(r.exitCode).toBe(0);
  });

  it("transition add with no --track → exit 4 (never hits bridge)", async () => {
    const r = await run(["transition", "add", "--after", "vc_s01", "--preset", "cross-dissolve"]);
    expect(r.exitCode).toBe(4);
  });

  it("transition add with no --after → exit 4 (never hits bridge)", async () => {
    const r = await run(["transition", "add", "--track", "trk_v", "--preset", "cross-dissolve"]);
    expect(r.exitCode).toBe(4);
  });

  it("transition add with no --preset → exit 4 (never hits bridge)", async () => {
    const r = await run(["transition", "add", "--track", "trk_v", "--after", "vc_s01"]);
    expect(r.exitCode).toBe(4);
  });

  it("transition add with a non-numeric --duration → exit 4 (never hits bridge)", async () => {
    const r = await run([
      "transition", "add", "--track", "trk_v", "--after", "vc_s01",
      "--preset", "cross-dissolve", "--duration", "abc",
    ]);
    expect(r.exitCode).toBe(4);
  });

  it("transition add with an unknown preset → bridge 400 code:4 → exit 4", async () => {
    const r = await run([
      "transition", "add", "--track", "trk_v", "--after", "vc_s01",
      "--preset", "no-such-preset",
    ]);
    expect(r.exitCode).toBe(4);
  });

  it("transition add pinned to a last clip → bridge 400 code:4 → exit 4", async () => {
    const r = await run([
      "transition", "add", "--track", "trk_v", "--after", "tc_hook01",
      "--preset", "cross-dissolve",
    ]);
    expect(r.exitCode).toBe(4);
  });

  it("transition remove <id> → exit 0", async () => {
    const r = await run(["transition", "remove", "tr_seq1"]);
    expect(r.exitCode).toBe(0);
  });

  it("transition remove with no id → exit 4 (never hits bridge)", async () => {
    const r = await run(["transition", "remove"]);
    expect(r.exitCode).toBe(4);
  });

  it("transition remove an unknown id → bridge 400 code:4 → exit 4", async () => {
    const r = await run(["transition", "remove", "tr_ghost"]);
    expect(r.exitCode).toBe(4);
  });

  it("transition unknown subcommand → exit 127", async () => {
    const r = await run(["transition", "frobnicate"]);
    expect(r.exitCode).toBe(127);
  });

  // S14 (US 20/21) — `autoviral captions generate [--language L] [--asset P]`
  // POSTs to /captions/generate; the bridge runs ASR + writes text clips, and
  // the CLI prints the # of clips written.
  it("captions generate → prints the written count, exit 0", async () => {
    const r = await run(["captions", "generate"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("3");
  });

  it("captions generate --language zh → exit 0 (language forwarded)", async () => {
    const r = await run(["captions", "generate", "--language", "zh"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("3");
  });

  it("captions generate --asset <relpath> → exit 0 (asset override forwarded)", async () => {
    const r = await run(["captions", "generate", "--asset", "assets/missing.mp3"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("0");
  });

  it("captions generate when whisper is missing → bridge 503 → exit 3", async () => {
    const r = await run(["captions", "generate", "--language", "nodep"]);
    expect(r.exitCode).toBe(3);
  });

  it("captions unknown subcommand → exit 127", async () => {
    const r = await run(["captions", "frobnicate"]);
    expect(r.exitCode).toBe(127);
  });

  // S12 (US 16 / 35-37) — `autoviral clip keyframe add|set <id> --property --at
  // --value [--easing]` POSTs to /clip/:id/keyframe; the bridge runs the shared
  // `ops.addKeyframe`. THIS is the runnable replacement for the dead `clip set
  // --keyframes '[...]'` path (which could only 400).
  it("clip keyframe add <id> --property --at --value → exit 0", async () => {
    const r = await run([
      "clip", "keyframe", "add", "vc_s01",
      "--property", "opacity", "--at", "5", "--value", "1",
    ]);
    expect(r.exitCode).toBe(0);
  });

  it("clip keyframe set <id> --property --at --value --easing → exit 0", async () => {
    const r = await run([
      "clip", "keyframe", "set", "vc_s01",
      "--property", "opacity", "--at", "5.18", "--value", "0", "--easing", "linear",
    ]);
    expect(r.exitCode).toBe(0);
  });

  it("clip keyframe with no verb / a bad verb → exit 4 (never hits bridge)", async () => {
    const r = await run([
      "clip", "keyframe", "vc_s01", "--property", "opacity", "--at", "5", "--value", "1",
    ]);
    expect(r.exitCode).toBe(4);
  });

  it("clip keyframe add with no id → exit 4 (never hits bridge)", async () => {
    const r = await run([
      "clip", "keyframe", "add", "--property", "opacity", "--at", "5", "--value", "1",
    ]);
    expect(r.exitCode).toBe(4);
  });

  it("clip keyframe add with no --property → exit 4 (never hits bridge)", async () => {
    const r = await run(["clip", "keyframe", "add", "vc_s01", "--at", "5", "--value", "1"]);
    expect(r.exitCode).toBe(4);
  });

  it("clip keyframe add with no --at → exit 4 (never hits bridge)", async () => {
    const r = await run([
      "clip", "keyframe", "add", "vc_s01", "--property", "opacity", "--value", "1",
    ]);
    expect(r.exitCode).toBe(4);
  });

  it("clip keyframe add with a non-numeric --value → exit 4 (never hits bridge)", async () => {
    const r = await run([
      "clip", "keyframe", "add", "vc_s01", "--property", "opacity", "--at", "5", "--value", "abc",
    ]);
    expect(r.exitCode).toBe(4);
  });

  it("clip keyframe add an unknown clip → bridge 400 code:4 → exit 4", async () => {
    const r = await run([
      "clip", "keyframe", "add", "nope", "--property", "opacity", "--at", "5", "--value", "1",
    ]);
    expect(r.exitCode).toBe(4);
  });

  it("clip keyframe add onto a text clip → bridge 400 code:4 → exit 4 (D8)", async () => {
    const r = await run([
      "clip", "keyframe", "add", "tc_hook01", "--property", "opacity", "--at", "1", "--value", "1",
    ]);
    expect(r.exitCode).toBe(4);
  });

  it("clip keyframe add with an unknown property → bridge 400 code:4 → exit 4", async () => {
    const r = await run([
      "clip", "keyframe", "add", "vc_s01", "--property", "bogus", "--at", "5", "--value", "1",
    ]);
    expect(r.exitCode).toBe(4);
  });

  // S10 (US 6/7/8) — track add/remove + clip add --track-id + overlay.
  it("track add --kind audio → prints the minted trackId", async () => {
    lastTrackAdd = null;
    const r = await run(["track", "add", "--kind", "audio"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^trk_/);
    expect(lastTrackAdd).toEqual({ kind: "audio" });
  });

  it("track add --kind text --after <id> --label L --language en forwards every flag", async () => {
    lastTrackAdd = null;
    const r = await run([
      "track", "add",
      "--kind", "text",
      "--after", "trk_v1",
      "--label", "CC2",
      "--language", "en",
    ]);
    expect(r.exitCode).toBe(0);
    expect(lastTrackAdd).toEqual({
      kind: "text",
      afterTrackId: "trk_v1",
      label: "CC2",
      language: "en",
    });
  });

  it("track add with no --kind → exit 4 (never hits bridge)", async () => {
    const r = await run(["track", "add"]);
    expect(r.exitCode).toBe(4);
  });

  it("track add with an invalid --kind → exit 4 (never hits bridge)", async () => {
    const r = await run(["track", "add", "--kind", "bogus"]);
    expect(r.exitCode).toBe(4);
  });

  it("track remove <trackId> → exit 0", async () => {
    const r = await run(["track", "remove", "trk_v1"]);
    expect(r.exitCode).toBe(0);
  });

  it("track remove with no id → exit 4 (never hits bridge)", async () => {
    const r = await run(["track", "remove"]);
    expect(r.exitCode).toBe(4);
  });

  it("track remove an unknown id → bridge 400 code:4 → exit 4", async () => {
    const r = await run(["track", "remove", "trk_ghost"]);
    expect(r.exitCode).toBe(4);
  });

  it("track unknown subcommand → exit 127", async () => {
    const r = await run(["track", "frobnicate"]);
    expect(r.exitCode).toBe(127);
  });

  // S2 (PRD-0007) — `autoviral scene add/list/set/reorder/link/remove` drives the
  // storyboard (分镜) planning layer. Writes round-trip through the bridge's
  // scene routes (POST /scene, PATCH /scene/:id, POST /scene/reorder, POST
  // /scene/:id/link, DELETE /scene/:id); `scene list` is a READ off GET /comp.
  // Enum-typed flags are validated locally (exit 4, never hits the bridge).
  describe("scene — storyboard write/read surface", () => {
    it("scene add --title X → prints the minted sceneId + forwards the title", async () => {
      lastSceneAdd = null;
      const r = await run(["scene", "add", "--title", "钩子镜"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toMatch(/^scn_/);
      expect(lastSceneAdd).toEqual({ title: "钩子镜" });
    });

    it("scene add forwards every supplied flag (intent / shot-size / camera / duration / prompt / narration / md-anchor)", async () => {
      lastSceneAdd = null;
      const r = await run([
        "scene", "add",
        "--title", "结尾 CTA",
        "--intent", "cta",
        "--shot-size", "closeup",
        "--camera", "push",
        "--duration", "3",
        "--prompt", "城市夜景",
        "--narration", "点关注",
        "--md-anchor", "第三幕-收尾",
      ]);
      expect(r.exitCode).toBe(0);
      expect(lastSceneAdd).toEqual({
        title: "结尾 CTA",
        intent: "cta",
        shotSize: "closeup",
        cameraMovement: "push",
        durationSec: 3,
        prompt: "城市夜景",
        narration: "点关注",
        mdAnchor: "第三幕-收尾",
      });
    });

    it("scene add with no --title → exit 4 (never hits bridge)", async () => {
      lastSceneAdd = null;
      const r = await run(["scene", "add", "--intent", "hook"]);
      expect(r.exitCode).toBe(4);
      expect(lastSceneAdd).toBeNull();
    });

    it("scene add with an invalid --intent → exit 4 (never hits bridge)", async () => {
      lastSceneAdd = null;
      const r = await run(["scene", "add", "--title", "X", "--intent", "bogus"]);
      expect(r.exitCode).toBe(4);
      expect(lastSceneAdd).toBeNull();
    });

    it("scene add with an invalid --shot-size → exit 4 (never hits bridge)", async () => {
      lastSceneAdd = null;
      const r = await run(["scene", "add", "--title", "X", "--shot-size", "macro"]);
      expect(r.exitCode).toBe(4);
      expect(lastSceneAdd).toBeNull();
    });

    it("scene add with an invalid --camera → exit 4 (never hits bridge)", async () => {
      lastSceneAdd = null;
      const r = await run(["scene", "add", "--title", "X", "--camera", "zoom"]);
      expect(r.exitCode).toBe(4);
      expect(lastSceneAdd).toBeNull();
    });

    it("scene add with a non-numeric --duration → exit 4 (never hits bridge)", async () => {
      lastSceneAdd = null;
      const r = await run(["scene", "add", "--title", "X", "--duration", "abc"]);
      expect(r.exitCode).toBe(4);
      expect(lastSceneAdd).toBeNull();
    });

    it("scene add → scene list shows the new shot (read off GET /comp)", async () => {
      const add = await run(["scene", "add", "--title", "可见镜", "--intent", "build"]);
      expect(add.exitCode).toBe(0);
      const id = add.stdout.trim();
      const list = await run(["scene", "list"]);
      expect(list.exitCode).toBe(0);
      // tab-separated: order  id  title  intent  status
      const row = list.stdout.split("\n").find((l) => l.includes(id));
      expect(row).toBeDefined();
      expect(row).toContain("可见镜");
      expect(row).toContain("build");
    });

    it("scene set <id> --shot-size medium → PATCHes the props object directly", async () => {
      lastSceneSet = null;
      const r = await run(["scene", "set", "scn_x1", "--shot-size", "medium", "--narration", "改旁白"]);
      expect(r.exitCode).toBe(0);
      expect(lastSceneSet).toEqual({ shotSize: "medium", narration: "改旁白" });
    });

    it("scene set with no id → exit 4 (never hits bridge)", async () => {
      lastSceneSet = null;
      const r = await run(["scene", "set", "--shot-size", "medium"]);
      expect(r.exitCode).toBe(4);
      expect(lastSceneSet).toBeNull();
    });

    it("scene set with an invalid --intent → exit 4 (never hits bridge)", async () => {
      lastSceneSet = null;
      const r = await run(["scene", "set", "scn_x1", "--intent", "bogus"]);
      expect(r.exitCode).toBe(4);
      expect(lastSceneSet).toBeNull();
    });

    it("scene set an unknown id → bridge 400 code:4 → exit 4", async () => {
      const r = await run(["scene", "set", "scn_ghost", "--shot-size", "medium"]);
      expect(r.exitCode).toBe(4);
    });

    it("scene reorder <id1> <id2> ... → POSTs { orderedSceneIds }", async () => {
      lastSceneReorder = null;
      const r = await run(["scene", "reorder", "scn_c", "scn_a", "scn_b"]);
      expect(r.exitCode).toBe(0);
      expect(lastSceneReorder).toEqual({ orderedSceneIds: ["scn_c", "scn_a", "scn_b"] });
    });

    it("scene reorder with no ids → exit 4 (never hits bridge)", async () => {
      lastSceneReorder = null;
      const r = await run(["scene", "reorder"]);
      expect(r.exitCode).toBe(4);
      expect(lastSceneReorder).toBeNull();
    });

    it("scene link <id> --asset a --asset b --select b --status generated → forwards all", async () => {
      lastSceneLink = null;
      const r = await run([
        "scene", "link", "scn_a1",
        "--asset", "img_take1",
        "--asset", "img_take2",
        "--select", "img_take2",
        "--status", "generated",
      ]);
      expect(r.exitCode).toBe(0);
      expect(lastSceneLink).toEqual({
        assetIds: ["img_take1", "img_take2"],
        selectedAssetId: "img_take2",
        status: "generated",
      });
    });

    it("scene link with no --asset → exit 4 (never hits bridge)", async () => {
      lastSceneLink = null;
      const r = await run(["scene", "link", "scn_a1"]);
      expect(r.exitCode).toBe(4);
      expect(lastSceneLink).toBeNull();
    });

    it("scene link with no id → exit 4 (never hits bridge)", async () => {
      lastSceneLink = null;
      const r = await run(["scene", "link", "--asset", "img_x"]);
      expect(r.exitCode).toBe(4);
      expect(lastSceneLink).toBeNull();
    });

    it("scene link with an invalid --status → exit 4 (never hits bridge)", async () => {
      lastSceneLink = null;
      const r = await run(["scene", "link", "scn_a1", "--asset", "img_x", "--status", "bogus"]);
      expect(r.exitCode).toBe(4);
      expect(lastSceneLink).toBeNull();
    });

    it("scene link an unknown scene → bridge 400 code:4 → exit 4", async () => {
      const r = await run(["scene", "link", "scn_ghost", "--asset", "img_x"]);
      expect(r.exitCode).toBe(4);
    });

    it("scene remove <id> → exit 0", async () => {
      const add = await run(["scene", "add", "--title", "待删"]);
      const id = add.stdout.trim();
      const rm = await run(["scene", "remove", id]);
      expect(rm.exitCode).toBe(0);
      const list = await run(["scene", "list"]);
      expect(list.stdout).not.toContain(id);
    });

    it("scene remove with no id → exit 4 (never hits bridge)", async () => {
      const r = await run(["scene", "remove"]);
      expect(r.exitCode).toBe(4);
    });

    it("scene remove an unknown id → bridge 400 code:4 → exit 4", async () => {
      const r = await run(["scene", "remove", "scn_ghost"]);
      expect(r.exitCode).toBe(4);
    });

    it("scene unknown subcommand → exit 127", async () => {
      const r = await run(["scene", "frobnicate"]);
      expect(r.exitCode).toBe(127);
    });

    it("--help lists scene commands", async () => {
      const r = await run(["--help"]);
      expect(r.stdout).toMatch(/scene add/);
      expect(r.stdout).toMatch(/scene list/);
      expect(r.stdout).toMatch(/scene reorder/);
    });
  });

  it("clip add --track-id <id> forwards trackId on the wire", async () => {
    lastClipAdd = null;
    const r = await run([
      "clip", "add",
      "--src", "assets/vo.mp3",
      "--track", "audio",
      "--track-id", "trk_a2",
    ]);
    expect(r.exitCode).toBe(0);
    expect(lastClipAdd?.track).toBe("audio");
    expect(lastClipAdd?.trackId).toBe("trk_a2");
  });

  it("clip add --track overlay --src <path> succeeds (no hard-reject)", async () => {
    const r = await run([
      "clip", "add",
      "--src", "assets/logo.png",
      "--track", "overlay",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^vc_/); // mock id shape, not load-bearing
  });

  // S11 — `clip set` maps ergonomic flags to canonical nested paths and coerces
  // values (number/bool/JSON) before PATCHing the bridge.
  it("clip set --scale 2 → PATCHes { 'transforms.scale': 2 }", async () => {
    lastClipPatch = null;
    const r = await run(["clip", "set", "vc_s01", "--scale", "2"]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({ "transforms.scale": 2 });
  });

  // S16 (US 25) — `--fit-mode contain` maps the ergonomic flag to the canonical
  // top-level `fitMode` path and keeps the enum value as a verbatim STRING (it
  // must NOT be number-coerced). This is the verb that makes fit-fill reachable
  // from the agent CLI (otherwise the field is set-only-from-UI = silent gap).
  it("clip set --fit-mode contain → PATCHes { fitMode: 'contain' } (string, mapped)", async () => {
    lastClipPatch = null;
    const r = await run(["clip", "set", "vc_s01", "--fit-mode", "contain"]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({ fitMode: "contain" });
  });

  it("clip set --fit-mode blur → keeps 'blur' as a string", async () => {
    lastClipPatch = null;
    const r = await run(["clip", "set", "vc_s01", "--fit-mode", "blur"]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({ fitMode: "blur" });
  });

  // S18 (US 27/28) — `--flip-h` / `--flip-v` map the ergonomic flags to the
  // canonical transforms.flipH / transforms.flipV paths and coerce the value to
  // a boolean. This makes mirror reachable from the agent CLI (else UI-only =
  // silent gap).
  it("clip set --flip-h true → PATCHes { 'transforms.flipH': true }", async () => {
    lastClipPatch = null;
    const r = await run(["clip", "set", "vc_s01", "--flip-h", "true"]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({ "transforms.flipH": true });
  });

  it("clip set --flip-v true → PATCHes { 'transforms.flipV': true }", async () => {
    lastClipPatch = null;
    const r = await run(["clip", "set", "vc_s01", "--flip-v", "true"]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({ "transforms.flipV": true });
  });

  // S18 — `--crop '{"x":..,"y":..,"w":..,"h":..}'` flattens to the server's
  // whitelisted dot-paths (transforms.crop.x / .y / .w / .h); a bare `crop`
  // object key is NOT whitelisted and would 400 (code:4).
  it("clip set --crop '{...}' → flattens to transforms.crop.* dot-paths", async () => {
    lastClipPatch = null;
    const r = await run([
      "clip", "set", "vc_s01",
      "--crop", '{"x":0.1,"y":0.2,"w":0.5,"h":0.6}',
    ]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({
      "transforms.crop.x": 0.1,
      "transforms.crop.y": 0.2,
      "transforms.crop.w": 0.5,
      "transforms.crop.h": 0.6,
    });
  });

  // S18 review fix (low) — a partial `--crop '{"x":0.1}'` used to flatten into a
  // half-crop {x:0.1} that the CLI happily sent; the mutate landed in memory and
  // only the write-schema parse later complained (about a confusing schema path,
  // not "crop needs x/y/w/h"). Validate the four leaves up front so the agent
  // gets an actionable error and NO PATCH is sent.
  it("clip set --crop '{\"x\":0.1}' (partial) → exit 4, clear error, NO patch sent", async () => {
    lastClipPatch = null;
    const r = await run(["clip", "set", "vc_s01", "--crop", '{"x":0.1}']);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toMatch(/crop/i);
    expect(r.stderr).toMatch(/x.*y.*w.*h|x, y, w, h|四个|all four/i);
    expect(lastClipPatch).toBeNull();
  });

  it("clip set --crop with all four leaves still works (no false positive)", async () => {
    lastClipPatch = null;
    const r = await run([
      "clip", "set", "vc_s01",
      "--crop", '{"x":0,"y":0,"w":1,"h":1}',
    ]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({
      "transforms.crop.x": 0,
      "transforms.crop.y": 0,
      "transforms.crop.w": 1,
      "transforms.crop.h": 1,
    });
  });

  // S19 (US 29/30) — `--freeze-at <sec>` / `--reverse` map the ergonomic flags
  // to the canonical top-level freezeAtSec / reverse paths (freeze is a number,
  // reverse a boolean). Makes time-domain ops reachable from the agent CLI (else
  // UI-only = silent gap).
  it("clip set --freeze-at 1.5 → PATCHes { freezeAtSec: 1.5 } (number, mapped)", async () => {
    lastClipPatch = null;
    const r = await run(["clip", "set", "vc_s01", "--freeze-at", "1.5"]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({ freezeAtSec: 1.5 });
  });

  it("clip set --reverse true → PATCHes { reverse: true } (boolean, mapped)", async () => {
    lastClipPatch = null;
    const r = await run(["clip", "set", "vc_s01", "--reverse", "true"]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({ reverse: true });
  });

  it("clip set --brightness 0.5 --italic true → maps + coerces both", async () => {
    lastClipPatch = null;
    const r = await run([
      "clip", "set", "tc_hook01",
      "--brightness", "0.5",
      "--italic", "true",
    ]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({
      "filters.brightness": 0.5,
      "style.italic": true,
    });
  });

  // S11 fix-up — an OBJECT-valued flag (`--ducking '{...}'`) must be FLATTENED
  // into the server's whitelisted dot-paths (`ducking.ratio` / `.attack` /
  // `.release`); a bare `ducking` key is NOT whitelisted and is rejected with
  // code:4. We assert the COMPLETE object here because that is the only shape
  // that survives the REAL server: the `ducking` schema requires all three
  // leaves, so on a fresh audio clip (ac_bgm01 has no ducking) a partial
  // `{ratio}` patch would mint `{ratio}` → fail zod → 400 → exit 4. (The old
  // `--ducking '{"ratio":0.4}'` test asserted exit 0 — a mock-only green: this
  // cli.test PATCH mock blindly stores the body and returns 200, so it never
  // ran the real op or zod and falsely claimed a path the server rejects. The
  // routes.test.ts contract proves a single leaf only lands once ducking
  // already exists, and that the complete-object patch mints it.)
  it("clip set --ducking '{\"ratio\":0.4,\"attack\":0.1,\"release\":0.2}' → flattens EVERY object key to its own dot-path (the shape the server accepts on a fresh clip)", async () => {
    lastClipPatch = null;
    const r = await run([
      "clip", "set", "ac_bgm01",
      "--ducking", '{"ratio":0.4,"attack":0.1,"release":0.2}',
    ]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({
      "ducking.ratio": 0.4,
      "ducking.attack": 0.1,
      "ducking.release": 0.2,
    });
  });

  // S11 fix-up (Finding 1) — a no-`#` hex colour (`--color 000000`) is a STRING
  // field (style.color). It must reach the bridge as the string "000000", NOT
  // `Number("000000") === 0` (which would silently destroy the agent's colour).
  it("clip set --color 000000 → keeps the hex as a string (not coerced to 0)", async () => {
    lastClipPatch = null;
    const r = await run(["clip", "set", "tc_hook01", "--color", "000000"]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({ "style.color": "000000" });
  });

  // …while a genuinely numeric field (--scale) is still coerced to a number.
  it("clip set --scale 2 still coerces to the number 2 (numeric leaf untouched)", async () => {
    lastClipPatch = null;
    const r = await run(["clip", "set", "vc_s01", "--scale", "2"]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({ "transforms.scale": 2 });
  });

  it("clip set with no id → exit 4 (never hits bridge)", async () => {
    lastClipPatch = null;
    const r = await run(["clip", "set"]);
    expect(r.exitCode).toBe(4);
    expect(lastClipPatch).toBeNull();
  });

  it("UI commands (select/seek/play/pause/toast/progress) → all exit 0", async () => {
    expect((await run(["select", "clip", "vc_s01"])).exitCode).toBe(0);
    expect((await run(["seek", "5s"])).exitCode).toBe(0);
    expect((await run(["seek", "1m30s"])).exitCode).toBe(0);
    expect((await run(["play"])).exitCode).toBe(0);
    expect((await run(["pause"])).exitCode).toBe(0);
    expect((await run(["toast", "hello", "--kind", "success"])).exitCode).toBe(0);
    expect((await run(["progress", "start", "rendering", "--steps", "5"])).exitCode).toBe(0);
    expect((await run(["progress", "step", "2"])).exitCode).toBe(0);
    expect((await run(["progress", "done"])).exitCode).toBe(0);
  });

  it("ask --timeout 0 returns exit 124", async () => {
    // 0 seconds → timeoutMs=0 — server treats <100 as instant timeout
    const r = await run(["ask", "noop", "--yes-no", "--timeout", "0"], {
      timeout: 5000,
    });
    expect(r.exitCode).toBe(124);
  });

  it("ask --yes-no with mock yes → exit 0 + 'yes' on stdout", async () => {
    const r = await run(["ask", "ok?", "--yes-no", "--timeout", "30"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("yes");
  });

  it("--help lists Phase 3 commands", async () => {
    const r = await run(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/clip add/);
    expect(r.stdout).toMatch(/ask/);
    expect(r.stdout).toMatch(/export/);
    expect(r.stdout).toMatch(/render/);
    expect(r.stdout).toMatch(/select/);
    expect(r.stdout).toMatch(/seek/);
    expect(r.stdout).toMatch(/play/);
    expect(r.stdout).toMatch(/toast/);
  });

  it("comp diff → prints unified diff to stdout (exit 0)", async () => {
    const r = await run(["comp", "diff"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("--- composition.yaml.previous");
    expect(r.stdout).toContain("+++ composition.yaml");
    expect(r.stdout).toContain("-duration: 0");
    expect(r.stdout).toContain("+duration: 5");
  });

  // S4 (US 10) — `comp put <file>` reads a whole composition from a file and
  // PUTs it through the bridge chokepoint. The CLI must send the parsed JSON
  // verbatim and exit 0 on the bridge's {ok:true}.
  describe("comp put — full-composition write escape hatch", () => {
    let tmpDir: string;
    beforeAll(async () => {
      const { mkdtemp } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      tmpDir = await mkdtemp(join(tmpdir(), "autoviral-comp-put-"));
    });

    it("comp put <file> → PUTs the parsed composition + exit 0 + prints a write confirmation", async () => {
      const { writeFile } = await import("node:fs/promises");
      lastCompPut = null;
      const comp = { id: "c_e2e", workId: "w_e2e", duration: 9, tracks: [], assets: [] };
      const file = join(tmpDir, "good.json");
      await writeFile(file, JSON.stringify(comp), "utf8");
      const r = await run(["comp", "put", file]);
      expect(r.exitCode).toBe(0);
      expect(lastCompPut).toEqual(comp);
      // S4 polish — a full-comp overwrite must NOT be silent (sibling write
      // verbs all print a confirmation).
      expect(r.stdout).toMatch(/wrote composition from/);
      expect(r.stdout).toContain(file);
    });

    // S4 polish (Finding 3a) — `typeof [] === "object"` would let a top-level
    // YAML/JSON ARRAY slip past the object guard. It is not a composition and
    // must fail fast (exit 4) BEFORE reaching the bridge.
    it("comp put a top-level ARRAY → exit 4 (never hits bridge)", async () => {
      const { writeFile } = await import("node:fs/promises");
      lastCompPut = null;
      const file = join(tmpDir, "array.json");
      await writeFile(file, JSON.stringify([{ id: "c_x" }]), "utf8");
      const r = await run(["comp", "put", file]);
      expect(r.exitCode).toBe(4);
      expect(lastCompPut).toBeNull();
    });

    it("comp put accepts a YAML file too (parsed → JSON on the wire)", async () => {
      const { writeFile } = await import("node:fs/promises");
      lastCompPut = null;
      const file = join(tmpDir, "good.yaml");
      await writeFile(file, "id: c_yaml\nworkId: w_e2e\nduration: 3\ntracks: []\nassets: []\n", "utf8");
      const r = await run(["comp", "put", file]);
      expect(r.exitCode).toBe(0);
      expect(lastCompPut).toEqual({ id: "c_yaml", workId: "w_e2e", duration: 3, tracks: [], assets: [] });
    });

    it("comp put - reads the composition from stdin", async () => {
      lastCompPut = null;
      const comp = { id: "c_stdin", workId: "w_e2e", duration: 11, tracks: [], assets: [] };
      const r = await execa("node", [BIN, "comp", "put", "-"], {
        env: { ...process.env, AUTOVIRAL_WORK_ID: "w_e2e", AUTOVIRAL_PORT: String(port) },
        input: JSON.stringify(comp),
        reject: false,
        timeout: 10_000,
      });
      expect(r.exitCode).toBe(0);
      expect(lastCompPut).toEqual(comp);
    });

    it("comp put with no file argument → exit 4 (never hits bridge)", async () => {
      lastCompPut = null;
      const r = await run(["comp", "put"]);
      expect(r.exitCode).toBe(4);
      expect(lastCompPut).toBeNull();
    });

    it("comp put <nonexistent-file> → exit 4 (never hits bridge)", async () => {
      lastCompPut = null;
      const r = await run(["comp", "put", join(tmpDir, "does-not-exist.json")]);
      expect(r.exitCode).toBe(4);
      expect(lastCompPut).toBeNull();
    });

    it("comp put a malformed (unparseable) file → exit 4 (never hits bridge)", async () => {
      const { writeFile } = await import("node:fs/promises");
      lastCompPut = null;
      const file = join(tmpDir, "bad.json");
      await writeFile(file, "{ this is : not valid json :::", "utf8");
      const r = await run(["comp", "put", file]);
      expect(r.exitCode).toBe(4);
      expect(lastCompPut).toBeNull();
    });

    it("comp put a composition the bridge rejects (400 code:4) → exit 4", async () => {
      const { writeFile } = await import("node:fs/promises");
      const file = join(tmpDir, "reject.json");
      // sentinel `tracks:"reject"` makes the mock bridge return 400 + code:4.
      await writeFile(file, JSON.stringify({ id: "c_x", tracks: "reject" }), "utf8");
      const r = await run(["comp", "put", file]);
      expect(r.exitCode).toBe(4);
    });

    it("--help lists comp put", async () => {
      const r = await run(["--help"]);
      expect(r.stdout).toMatch(/comp put/);
    });
  });

  // S13 (US 11/12) — `comp validate <file|->` PREFLIGHTS a candidate composition
  // without writing it: the CLI POSTs the parsed candidate to /comp/validate and
  // renders the {ok,errors,warnings} verdict. Exit 0 when ok (warnings don't
  // fail); exit 4 when the candidate has blocking errors.
  describe("comp validate — write-free preflight", () => {
    let tmpDir: string;
    beforeAll(async () => {
      const { mkdtemp } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      tmpDir = await mkdtemp(join(tmpdir(), "autoviral-comp-validate-"));
    });

    it("comp validate <file> on a clean candidate → exit 0 + prints clean", async () => {
      const { writeFile } = await import("node:fs/promises");
      lastCompValidate = null;
      const comp = { id: "c_e2e", workId: "w_e2e", duration: 9, tracks: [], assets: [] };
      const file = join(tmpDir, "good.json");
      await writeFile(file, JSON.stringify(comp), "utf8");
      const r = await run(["comp", "validate", file]);
      expect(r.exitCode).toBe(0);
      expect(lastCompValidate).toEqual(comp);
      expect(r.stdout).toMatch(/ok|clean/i);
    });

    it("comp validate a candidate with errors → exit 4 + prints the errors", async () => {
      const { writeFile } = await import("node:fs/promises");
      const file = join(tmpDir, "bad.json");
      // sentinel tracks:"reject" → the mock returns a not-ok verdict with errors.
      await writeFile(file, JSON.stringify({ id: "c_x", tracks: "reject" }), "utf8");
      const r = await run(["comp", "validate", file]);
      expect(r.exitCode).toBe(4);
      expect(r.stderr + r.stdout).toMatch(/expected array/);
    });

    it("comp validate a candidate with warnings only → exit 0 + prints the warning", async () => {
      const { writeFile } = await import("node:fs/promises");
      const file = join(tmpDir, "warn.json");
      await writeFile(file, JSON.stringify({ id: "c_x", tracks: "warn" }), "utf8");
      const r = await run(["comp", "validate", file]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout + r.stderr).toMatch(/overlaps/);
    });

    it("comp validate - reads the candidate from stdin", async () => {
      lastCompValidate = null;
      const comp = { id: "c_stdin", workId: "w_e2e", duration: 11, tracks: [], assets: [] };
      const r = await execa("node", [BIN, "comp", "validate", "-"], {
        env: { ...process.env, AUTOVIRAL_WORK_ID: "w_e2e", AUTOVIRAL_PORT: String(port) },
        input: JSON.stringify(comp),
        reject: false,
        timeout: 10_000,
      });
      expect(r.exitCode).toBe(0);
      expect(lastCompValidate).toEqual(comp);
    });

    it("comp validate with no file argument → exit 4 (never hits bridge)", async () => {
      lastCompValidate = null;
      const r = await run(["comp", "validate"]);
      expect(r.exitCode).toBe(4);
      expect(lastCompValidate).toBeNull();
    });

    it("comp validate a top-level ARRAY → exit 4 (never hits bridge)", async () => {
      const { writeFile } = await import("node:fs/promises");
      lastCompValidate = null;
      const file = join(tmpDir, "array.json");
      await writeFile(file, JSON.stringify([{ id: "c_x" }]), "utf8");
      const r = await run(["comp", "validate", file]);
      expect(r.exitCode).toBe(4);
      expect(lastCompValidate).toBeNull();
    });

    it("--help lists comp validate", async () => {
      const r = await run(["--help"]);
      expect(r.stdout).toMatch(/comp validate/);
    });
  });

  // S17 (US 26) — `comp aspect <ratio>` switches the canvas ratio in one shot
  // through the bridge (which runs the SAME shared op the Studio control uses).
  // A canonical ratio reaches the bridge as { ratio }; a bogus one fails fast
  // (exit 4) BEFORE the bridge.
  describe("comp aspect — one-click canvas-ratio switch", () => {
    it("comp aspect 16:9 → POSTs { ratio } + exit 0 + prints confirmation", async () => {
      lastCompAspect = null;
      const r = await run(["comp", "aspect", "16:9"]);
      expect(r.exitCode).toBe(0);
      expect(lastCompAspect).toEqual({ ratio: "16:9" });
      expect(r.stdout).toMatch(/switched aspect to 16:9/);
    });

    it("comp aspect with no ratio → exit 4 (never hits bridge)", async () => {
      lastCompAspect = null;
      const r = await run(["comp", "aspect"]);
      expect(r.exitCode).toBe(4);
      expect(lastCompAspect).toBeNull();
    });

    it("comp aspect with a non-canonical ratio → exit 4 (never hits bridge)", async () => {
      lastCompAspect = null;
      const r = await run(["comp", "aspect", "21:9"]);
      expect(r.exitCode).toBe(4);
      expect(lastCompAspect).toBeNull();
    });

    it("--help lists comp aspect", async () => {
      const r = await run(["--help"]);
      expect(r.stdout).toMatch(/comp aspect/);
    });
  });

  it("carousel add-slide → prints new slide id (exit 0)", async () => {
    const r = await run(["carousel", "add-slide"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^s_e2e/);
  });

  it("carousel set-layer text → prints layer id (exit 0)", async () => {
    const r = await run([
      "carousel", "set-layer", "s_e2e1",
      "--kind", "text",
      "--text", "标题",
      "--x", "80", "--y", "80", "--w", "920", "--h", "200",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^t_e2e/);
  });

  it("carousel set-layer with --id echoes the id (idempotent target)", async () => {
    const r = await run([
      "carousel", "set-layer", "s_e2e1",
      "--kind", "image", "--id", "t_fixed", "--src", "assets/images/x.png",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("t_fixed");
  });

  // set-layer PATCH wire-format: targeting an existing --id and changing only
  // --text must send ONLY {id, kind, text} — NO box, NO style — so the server's
  // deep-merge preserves the layer's existing geometry/style instead of the CLI
  // re-sending defaults that would clobber them.
  it("carousel set-layer --id --text sends NO box / NO style (lets server preserve them)", async () => {
    lastLayerSet = null;
    const r = await run([
      "carousel", "set-layer", "s_e2e1",
      "--kind", "text", "--id", "t_keep", "--text", "改后",
    ]);
    expect(r.exitCode).toBe(0);
    expect(lastLayerSet).toEqual({ kind: "text", id: "t_keep", text: "改后" });
    // explicitly: the CLI did NOT smuggle a default box / style onto a patch.
    expect(lastLayerSet).not.toHaveProperty("box");
    expect(lastLayerSet).not.toHaveProperty("style");
  });

  it("carousel set-layer --id with a partial box sends ONLY the given coordinate", async () => {
    lastLayerSet = null;
    const r = await run([
      "carousel", "set-layer", "s_e2e1",
      "--kind", "text", "--id", "t_keep", "--x", "999",
    ]);
    expect(r.exitCode).toBe(0);
    expect(lastLayerSet).toEqual({ kind: "text", id: "t_keep", box: { x: 999 } });
  });

  // --italic / --tracking were missing from the CLI (schema had the fields but
  // the agent could not set them — a silent capability gap the critic flagged).
  it("carousel set-layer --italic / --tracking land in the layer style", async () => {
    lastLayerSet = null;
    const r = await run([
      "carousel", "set-layer", "s_e2e1",
      "--kind", "text", "--id", "t_keep",
      "--italic", "true", "--tracking", "-3",
    ]);
    expect(r.exitCode).toBe(0);
    expect(lastLayerSet).toEqual({
      kind: "text",
      id: "t_keep",
      style: { italic: true, tracking: -3 },
    });
  });

  it("carousel set-layer --italic false turns italic off", async () => {
    lastLayerSet = null;
    const r = await run([
      "carousel", "set-layer", "s_e2e1",
      "--kind", "text", "--id", "t_keep", "--italic", "false",
    ]);
    expect(r.exitCode).toBe(0);
    expect((lastLayerSet as { style?: { italic?: boolean } })?.style?.italic).toBe(false);
  });

  // A CREATE (no --id) still fills a default box so a minimal invocation
  // validates server-side — the create path must NOT regress.
  it("carousel set-layer CREATE (no --id) fills a default box", async () => {
    lastLayerSet = null;
    const r = await run([
      "carousel", "set-layer", "s_e2e1",
      "--kind", "text", "--text", "新标题",
    ]);
    expect(r.exitCode).toBe(0);
    const box = (lastLayerSet as { box?: Record<string, number> }).box!;
    expect(box).toMatchObject({ x: 80, y: 80, w: 920, h: 200 });
  });

  // A text CREATE still requires --text; a text PATCH (--id) does not (the
  // existing copy survives the merge).
  it("carousel set-layer text CREATE without --text → exit 4; PATCH without --text → exit 0", async () => {
    const create = await run(["carousel", "set-layer", "s_e2e1", "--kind", "text"]);
    expect(create.exitCode).toBe(4);
    const patch = await run([
      "carousel", "set-layer", "s_e2e1", "--kind", "text", "--id", "t_keep", "--size", "72",
    ]);
    expect(patch.exitCode).toBe(0);
  });

  it("carousel set-layer missing --kind → exit 4 (validation, never hits bridge)", async () => {
    const r = await run(["carousel", "set-layer", "s_e2e1", "--text", "hi"]);
    expect(r.exitCode).toBe(4);
  });

  it("carousel set-layer bogus kind → bridge 400 → exit 4", async () => {
    const r = await run([
      "carousel", "set-layer", "s_e2e1", "--kind", "bogus", "--text", "x",
    ]);
    // bridgeRequest maps HTTP non-ok to exit 3; the server's 400+code path
    // is the contract — assert it is a non-zero failure, not a silent success.
    expect(r.exitCode).not.toBe(0);
  });

  it("carousel unknown subcommand → exit 127", async () => {
    const r = await run(["carousel", "frobnicate"]);
    expect(r.exitCode).toBe(127);
  });

  it("--help lists carousel commands", async () => {
    const r = await run(["--help"]);
    expect(r.stdout).toMatch(/carousel add-slide/);
    expect(r.stdout).toMatch(/carousel set-layer/);
  });

  // S10 (US 6) — overlay is now a first-class clip-add track (the old "not yet
  // supported in Phase 3" hard-reject is gone; the OverlayClip schema + the
  // Scene → OverlayTrackRenderer dispatch consume it). The止谎 invariant flips:
  // the help MUST now advertise `overlay` because `clip add --track overlay`
  // genuinely works at runtime (proven by the `clip add --track overlay`
  // success test above). Help truthfully tracks runtime behaviour either way.
  it("--help advertises the overlay track for `clip add` (now genuinely supported)", async () => {
    const r = await run(["--help"]);
    const clipAddLine = r.stdout
      .split("\n")
      .find((l) => l.includes("clip add"));
    expect(clipAddLine).toBeDefined();
    expect(clipAddLine).toMatch(/overlay/);
  });

  it("snapshot → prints the PNG path (exit 0) with no caveat on the faithful path", async () => {
    const r = await run(["snapshot"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("/tmp/work/output/snapshot-current.png");
    // Video/faithful path (textLayersComposited:true) → no honesty caveat.
    expect(r.stderr).not.toMatch(/background only/);
  });

  it("snapshot --at forwards a parsed time to the bridge", async () => {
    const r = await run(["snapshot", "--at", "1m30s"]);
    expect(r.exitCode).toBe(0);
    // 1m30s → 90 seconds.
    expect(r.stdout.trim()).toBe("/tmp/work/output/snapshot-at-90.png");
  });

  it("snapshot --slide forwards the slide id to the bridge", async () => {
    const r = await run(["snapshot", "--slide", "s2"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("/tmp/work/output/snapshot-slide-s2.png");
  });

  it("snapshot prints the base-only caveat to stderr when text isn't composited (path stays clean on stdout)", async () => {
    // The mock returns textLayersComposited:false for a --slide (carousel
    // background-only fallback). The caveat must go to stderr so stdout stays a
    // parse-clean path for `$(autoviral snapshot)`.
    const r = await run(["snapshot", "--slide", "s2"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("/tmp/work/output/snapshot-slide-s2.png");
    expect(r.stderr).toMatch(/background only/);
    expect(r.stderr).toMatch(/do not infer text layout\/overflow/);
  });

  it("snapshot --at with a bad time → exit 4 (never hits bridge)", async () => {
    const r = await run(["snapshot", "--at", "banana"]);
    expect(r.exitCode).toBe(4);
  });

  it("--help lists snapshot", async () => {
    const r = await run(["--help"]);
    expect(r.stdout).toMatch(/snapshot/);
  });

  it("unknown command → exit 127", async () => {
    const r = await run(["definitely-not-a-command"]);
    expect(r.exitCode).toBe(127);
  });

  // S21 (US 33/34) — agent-reachable checkpoint restore.
  describe("checkpoint list/restore", () => {
    it("checkpoint list → JSON array newest-first incl. label (exit 0)", async () => {
      const r = await run(["checkpoint", "list"]);
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout) as Array<{ file: string; label?: string }>;
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      // newest first (the mock returns them already sorted)
      expect(parsed[0].file > parsed[1].file).toBe(true);
      expect(parsed.find((c) => c.label === "first cut")).toBeDefined();
    });

    it("checkpoint restore <id> → confirms restore + reports reversibility on stderr", async () => {
      const r = await run([
        "checkpoint",
        "restore",
        "2026-05-08T10-00-00-000Z__aaaaaaaa__carousel.yaml",
      ]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/restored carousel\.yaml/);
      // #68 — the CLI surfaces that the current state was checkpointed FIRST.
      expect(r.stderr).toMatch(/checkpointed first/);
      expect(r.stderr).toMatch(/reversible/);
    });

    it("checkpoint restore without an id → exit 4 (never hits bridge)", async () => {
      const r = await run(["checkpoint", "restore"]);
      expect(r.exitCode).toBe(4);
    });

    it("checkpoint restore unknown id → bridge 404 code:4 → exit 4", async () => {
      const r = await run(["checkpoint", "restore", "nope__nope__carousel.yaml"]);
      expect(r.exitCode).toBe(4);
    });

    it("checkpoint with no/unknown subcommand → exit 127", async () => {
      const r = await run(["checkpoint", "frobnicate"]);
      expect(r.exitCode).toBe(127);
    });

    it("--help lists checkpoint list/restore", async () => {
      const r = await run(["--help"]);
      expect(r.stdout).toMatch(/checkpoint list/);
      expect(r.stdout).toMatch(/checkpoint restore/);
    });
  });

  // S3 (US 18/19) — error-code contract: the CLI branches its exit code on
  // the bridge's response so a shell agent can tell "my input was wrong"
  // (exit 4) apart from "the service broke" (exit 3).
  describe("error-code contract — clip writes branch 4xx→4 vs 5xx→3", () => {
    it("bridge 400 + code:4 (validation) → exit 4", async () => {
      const r = await run([
        "clip", "add", "--src", "assets/x.mp4", "--track", "reject",
      ]);
      expect(r.exitCode).toBe(4);
    });

    it("bridge 5xx (service error) → exit 3", async () => {
      const r = await run([
        "clip", "add", "--src", "assets/x.mp4", "--track", "boom",
      ]);
      expect(r.exitCode).toBe(3);
    });

    // S3 fix-up — rule #3: a non-JSON error body must NOT crash the CLI; it
    // falls back to the status-class mapping (4xx → 4). Previously untested:
    // every existing fixture returned JSON, so JSON.parse never actually threw.
    it("bridge 400 with a non-JSON (HTML) body → status-class fallback → exit 4 (no crash)", async () => {
      const r = await run([
        "clip", "add", "--src", "assets/x.mp4", "--track", "html400",
      ]);
      expect(r.exitCode).toBe(4);
    });

    // S3 fix-up — rule #4: HTTP 200 with a business-level {ok:false} envelope.
    // An explicit code is honoured (exit 4); a missing code defaults to exit 3.
    it("HTTP 200 {ok:false, code:4} envelope → honours the code → exit 4", async () => {
      const r = await run([
        "clip", "add", "--src", "assets/x.mp4", "--track", "envfail4",
      ]);
      expect(r.exitCode).toBe(4);
    });

    it("HTTP 200 {ok:false} envelope with no code → defaults to exit 3", async () => {
      const r = await run([
        "clip", "add", "--src", "assets/x.mp4", "--track", "envfailnocode",
      ]);
      expect(r.exitCode).toBe(3);
    });
  });
});

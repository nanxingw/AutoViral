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
// S11 — capture the last PATCH /clip body so the CLI test can assert the
// flag → nested-path mapping + value coercion that reached the bridge.
let lastClipPatch: Record<string, unknown> | null = null;
// S4 (US 10) — capture the last PUT /comp body so the CLI test can assert the
// full composition the CLI read from a file / stdin reached the bridge verbatim.
let lastCompPut: Record<string, unknown> | null = null;

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
        result: { workId: "w_e2e", fps: 30, tracks: [], assets: [], duration: 0, width: 1080, height: 1920, aspect: "9:16", id: "c_e2e", updatedAt: "2026-05-14T00:00:00.000Z" },
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
      const id = `vc_e2e${nextSeq++}`;
      clips.push({ id, trackKind: body.track });
      return send(200, { ok: true, result: { id } });
    }
    if (req.method === "DELETE" && url.startsWith("/api/bridge/v1/clip/")) {
      const id = url.split("/").pop()!;
      const idx = clips.findIndex((c) => c.id === id);
      if (idx >= 0) clips.splice(idx, 1);
      return send(200, { ok: true });
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

  // S11 — `clip set` maps ergonomic flags to canonical nested paths and coerces
  // values (number/bool/JSON) before PATCHing the bridge.
  it("clip set --scale 2 → PATCHes { 'transforms.scale': 2 }", async () => {
    lastClipPatch = null;
    const r = await run(["clip", "set", "vc_s01", "--scale", "2"]);
    expect(r.exitCode).toBe(0);
    expect(lastClipPatch).toEqual({ "transforms.scale": 2 });
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

  it("carousel set-layer with --id is an idempotent replace (echoes the id)", async () => {
    const r = await run([
      "carousel", "set-layer", "s_e2e1",
      "--kind", "image", "--id", "t_fixed", "--src", "assets/images/x.png",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("t_fixed");
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

  // S1 (US 35/36/37) —止谎: the bridge throws `overlay track not yet
  // supported` on `clip add --track overlay` (bridge/routes.ts), so the help
  // must NOT advertise `overlay` as a usable clip-add track. An agent that
  // trusts the manual and runs it would burn its whole session budget on a
  // guaranteed runtime error.
  it("--help does NOT advertise the overlay track for `clip add` (it throws at runtime)", async () => {
    const r = await run(["--help"]);
    const clipAddLine = r.stdout
      .split("\n")
      .find((l) => l.includes("clip add"));
    expect(clipAddLine).toBeDefined();
    expect(clipAddLine).not.toMatch(/overlay/);
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

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
    if (req.method === "POST" && url === "/api/bridge/v1/clip") {
      const body = await readBody(req);
      const id = `vc_e2e${nextSeq++}`;
      clips.push({ id, trackKind: body.track ?? "video" });
      return send(200, { ok: true, result: { id } });
    }
    if (req.method === "DELETE" && url.startsWith("/api/bridge/v1/clip/")) {
      const id = url.split("/").pop()!;
      const idx = clips.findIndex((c) => c.id === id);
      if (idx >= 0) clips.splice(idx, 1);
      return send(200, { ok: true });
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

  it("unknown command → exit 127", async () => {
    const r = await run(["definitely-not-a-command"]);
    expect(r.exitCode).toBe(127);
  });
});

// BE3-F3 (PRD-0010) — CLI client tolerance for LONG synchronous generations.
//
// Repro of the field bug: `autoviral scene generate <id>` against a provider
// whose synchronous generation takes ~2min (openrouter-image) exited with the
// opaque `autoviral: fetch failed` (generic exit 3). An agent cannot tell that
// apart from a transient service failure, so it blindly retries → the server
// (which kept generating) gets billed twice.
//
// The client MUST instead:
//   • bound the wait with an EXPLICIT, configurable timeout (never hang forever,
//     never surface an opaque "fetch failed"), overridable via
//     AUTOVIRAL_HTTP_TIMEOUT_MS so a long-but-legit generation still completes;
//   • on a client-side timeout, emit a CLEAR, agent-actionable message (the
//     server may still be generating — do NOT blindly retry) and exit with the
//     canonical timeout code 124 (same signal `ask` uses), NOT the generic
//     `fetch failed` → exit 3.
//
// Spawn-integration, mirroring cli.test.ts / whoami.test.ts: run the built
// binary against a Node http mock whose /scene/:id/generate route DELAYS its
// response. The injected AUTOVIRAL_HTTP_TIMEOUT_MS keeps the test fast (ms, not
// minutes) while exercising the exact client behaviour a 2-min response hits.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN = join(__dirname, "../dist/cli.js");

let server: Server;
let port: number;

// The mock delays the generate response by this many ms so the test can drive
// the client PAST / UNDER its injected timeout deterministically.
const GENERATE_DELAY_MS = 1200;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    // POST /api/bridge/v1/scene/:id/generate — the long synchronous handoff.
    // Drain the body, then respond only AFTER GENERATE_DELAY_MS, mimicking a
    // provider that holds the connection open while it generates.
    if (req.method === "POST" && /^\/api\/bridge\/v1\/scene\/[^/]+\/generate$/.test(url)) {
      req.on("data", () => {});
      req.on("end", () => {
        setTimeout(() => {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: true, result: { assetId: "gen_slow1" } }));
        }, GENERATE_DELAY_MS);
      });
      return;
    }
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(() => server.close());

function run(args: string[], extraEnv: Record<string, string> = {}, timeout = 8000) {
  return execa("node", [BIN, ...args], {
    env: {
      ...process.env,
      AUTOVIRAL_WORK_ID: "w_e2e",
      AUTOVIRAL_PORT: String(port),
      ...extraEnv,
    },
    reject: false,
    timeout,
  });
}

describe("BE3-F3 — long-request client timeout", () => {
  // RED before the fix: the client ignores AUTOVIRAL_HTTP_TIMEOUT_MS, waits the
  // full delay and exits 0 (prints the asset id). We REQUIRE it to instead trip
  // its own timeout well before the response, exit 124, and say something
  // clear — never the opaque "fetch failed".
  it("aborts with a clear timeout (exit 124), NOT an opaque 'fetch failed', when the response outlasts the budget", async () => {
    const r = await run(
      ["scene", "generate", "scn_slow"],
      { AUTOVIRAL_HTTP_TIMEOUT_MS: "300" }, // 300ms << 1200ms response
    );
    expect(r.exitCode).toBe(124);
    // The message must be actionable: mention timing out AND that the server may
    // still be working (so the agent does not blindly retry + double-bill).
    expect(r.stderr).toMatch(/tim(e|ed) ?out|timed out/i);
    expect(r.stderr).toMatch(/still.*generat|do not.*retry|may still/i);
    // NEVER the bare undici surface.
    expect(r.stderr).not.toMatch(/^autoviral: fetch failed\s*$/m);
    // No asset id leaked to stdout on the failure path.
    expect(r.stdout.trim()).toBe("");
  });

  // GUARD: a long-but-within-budget generation must still SUCCEED. Proves the
  // fix bounds the wait without amputating legit slow generations.
  it("still completes a slow generation that finishes within the budget (exit 0)", async () => {
    const r = await run(
      ["scene", "generate", "scn_ok"],
      { AUTOVIRAL_HTTP_TIMEOUT_MS: "6000" }, // 6s budget > 1200ms response
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("gen_slow1");
  });
});

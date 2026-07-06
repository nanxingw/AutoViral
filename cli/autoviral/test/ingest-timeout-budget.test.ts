// BE3-F3 review fix (PRD-0010) — the shared 10-min HTTP ceiling introduced by
// c0fbbf8 must NOT undercut `ingest youtube`'s documented client-side tolerance.
//
// commands/ingest.ts states in its header contract: "Long-running — agents
// should not timeout client-side under ~15 min for typical 5–10 minute YouTube
// clips." c0fbbf8 routed EVERY bridgeRequest (ingest included) through a single
// DEFAULT_HTTP_TIMEOUT_MS = 10-min ceiling, i.e. BELOW that documented 15-min
// floor — a real regression that would abort a legit long ingest at 10 min
// unless the user set AUTOVIRAL_HTTP_TIMEOUT_MS.
//
// The fix: a per-call timeout override so ingest declares its own generous
// budget (>= its 15-min contract), while the generic default stays 10 min and
// AUTOVIRAL_HTTP_TIMEOUT_MS still overrides both.
//
// Two layers of proof:
//   1. UNIT (red-first): the budget-resolution mechanism + ingest's declared
//      budget contract — pure, fast, deterministic.
//   2. SPAWN (regression guard): the ingest command is actually wired through
//      the timeout machinery (honors the override, emits a clean 124 — never
//      the opaque "fetch failed").

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { httpTimeoutMs, DEFAULT_HTTP_TIMEOUT_MS, INGEST_TIMEOUT_MS } from "../src/client.js";

// ── Layer 1: budget-resolution contract ────────────────────────────────────
describe("BE3-F3 fix — HTTP budget resolution honors a per-call fallback", () => {
  const ENV = "AUTOVIRAL_HTTP_TIMEOUT_MS";
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ENV];
    delete process.env[ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  it("uses the generic 10-min default when no fallback is given and env is unset", () => {
    expect(httpTimeoutMs()).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    expect(DEFAULT_HTTP_TIMEOUT_MS).toBe(600_000);
  });

  it("honors the caller's per-call fallback (ingest's longer budget) when env is unset", () => {
    // The regression: ingest must NOT be capped at the generic default.
    expect(httpTimeoutMs(INGEST_TIMEOUT_MS)).toBe(INGEST_TIMEOUT_MS);
  });

  it("declares an ingest budget that meets the documented ~15-min contract and exceeds the generic default", () => {
    expect(INGEST_TIMEOUT_MS).toBeGreaterThanOrEqual(900_000); // >= 15 min floor
    expect(INGEST_TIMEOUT_MS).toBeGreaterThan(DEFAULT_HTTP_TIMEOUT_MS); // not capped at generic 10 min
  });

  it("lets AUTOVIRAL_HTTP_TIMEOUT_MS override BOTH the generic default and a per-call fallback", () => {
    process.env[ENV] = "5000";
    expect(httpTimeoutMs()).toBe(5000);
    expect(httpTimeoutMs(INGEST_TIMEOUT_MS)).toBe(5000);
  });

  it("falls back to the per-call value (not the generic default) when env is invalid", () => {
    for (const bad of ["abc", "0", "-1", ""]) {
      process.env[ENV] = bad;
      expect(httpTimeoutMs(INGEST_TIMEOUT_MS)).toBe(INGEST_TIMEOUT_MS);
      expect(httpTimeoutMs()).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    }
  });
});

// ── Layer 2: ingest command is wired through the timeout machinery ──────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN = join(__dirname, "../dist/cli.js");

let server: Server;
let port: number;
const INGEST_DELAY_MS = 1200;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/api/bridge/v1/ingest/youtube") {
      req.on("data", () => {});
      req.on("end", () => {
        setTimeout(() => {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              ok: true,
              result: {
                workId: "w_e2e",
                sourceClipPath: "/tmp/src.mp4",
                durationSec: 42,
                segmentCount: 7,
                language: "en",
                targetLanguage: "zh-CN",
              },
            }),
          );
        }, INGEST_DELAY_MS);
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

describe("BE3-F3 fix — ingest honors the timeout machinery, not an opaque fetch failed", () => {
  it("aborts a long ingest with a clean 124 (not 'fetch failed') when it outlasts the (overridden) budget", async () => {
    const r = await run(
      ["ingest", "youtube", "https://youtu.be/x"],
      { AUTOVIRAL_HTTP_TIMEOUT_MS: "300" }, // 300ms << 1200ms response
    );
    expect(r.exitCode).toBe(124);
    expect(r.stderr).toMatch(/tim(e|ed) ?out|timed out/i);
    expect(r.stderr).toMatch(/still.*generat|do not.*retry|may still/i);
    expect(r.stderr).not.toMatch(/^autoviral: fetch failed\s*$/m);
    expect(r.stdout.trim()).toBe("");
  });

  it("completes a slow ingest that finishes within budget (exit 0, prints the summary)", async () => {
    const r = await run(
      ["ingest", "youtube", "https://youtu.be/x"],
      { AUTOVIRAL_HTTP_TIMEOUT_MS: "6000" }, // 6s budget > 1200ms response
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("/tmp/src.mp4");
    expect(r.stdout).toMatch(/7 segments/);
  });
});

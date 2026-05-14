// Integration test for `autoviral whoami`.
//
// Spawns the built CLI as a subprocess (execa) pointed at a mock HTTP
// server that mimics the bridge's `GET /whoami` shape. stdout is captured
// as non-TTY by execa, so the CLI should emit JSON (not YAML).

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/api/bridge/v1/whoami") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          result: { workId: "w_t", cwd: "/tmp", port: 9999, version: "0.1.0" },
        }),
      );
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(() => server.close());

const BIN = join(__dirname, "../dist/cli.js");

describe("autoviral whoami", () => {
  it("prints JSON when stdout not tty", async () => {
    const { stdout, exitCode } = await execa("node", [BIN, "whoami"], {
      env: { AUTOVIRAL_WORK_ID: "w_t", AUTOVIRAL_PORT: String(port) },
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.workId).toBe("w_t");
  });
});

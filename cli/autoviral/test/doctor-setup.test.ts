// `autoviral doctor` / `autoviral setup` — I14 (PRD-0003 §1).
//
// Two layers, mirroring the repo conventions:
//   • SPAWN integration (like cli.test.ts) — run the built binary and assert the
//     readiness table + exit codes on the real local filesystem, controlling the
//     ffmpeg/ffprobe resolution via FFMPEG_PATH/FFPROBE_PATH (env tier) and an
//     isolated AUTOVIRAL_DATA_DIR so no managed copy / venv leaks in.
//   • UNIT (injected) — drive the pure classifier + the install primitives with
//     MOCKED deps so NO real ffmpeg copy / venv / pip ever runs.
//
// The setup wiring test vi.mocks ../src/deps-probe.js so setupCommand's calls to
// installManagedFfmpeg / installTtsVenv are observed without a real install.

import {
  describe,
  expect,
  it,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN = join(__dirname, "../dist/cli.js");

// ── SPAWN integration (built binary) ─────────────────────────────────────────

describe("autoviral doctor — spawn", () => {
  let dataDir: string;
  let fakeFfmpeg: string;
  let fakeFfprobe: string;

  beforeAll(() => {
    // Isolated data dir → no managed copy / venv from a prior run can taint the
    // probes. Two real (empty) files stand in as the env-override binaries.
    const root = mkdtempSync(join(tmpdir(), "av-doctor-"));
    dataDir = join(root, "data");
    fakeFfmpeg = join(root, "ffmpeg");
    fakeFfprobe = join(root, "ffprobe");
    writeFileSync(fakeFfmpeg, "#!/bin/sh\n");
    writeFileSync(fakeFfprobe, "#!/bin/sh\n");
    chmodSync(fakeFfmpeg, 0o755);
    chmodSync(fakeFfprobe, 0o755);
  });

  it("all core present (env override) → exit 0 + table", async () => {
    const r = await execa("node", [BIN, "doctor"], {
      reject: false,
      env: {
        AUTOVIRAL_DATA_DIR: dataDir,
        FFMPEG_PATH: fakeFfmpeg,
        FFPROBE_PATH: fakeFfprobe,
      },
    });
    expect(r.exitCode).toBe(0);
    // Readiness table: a ✓ row for ffmpeg/ffprobe pointing at the env override.
    expect(r.stdout).toMatch(/dependency readiness/);
    expect(r.stdout).toMatch(/✓\s+ffmpeg/);
    expect(r.stdout).toMatch(/✓\s+ffprobe/);
    expect(r.stdout).toContain(fakeFfmpeg);
    expect(r.stdout).toMatch(/Core dependencies OK/);
    // The four dependency families are all listed.
    expect(r.stdout).toMatch(/tts venv/);
    expect(r.stdout).toMatch(/playwright/);
    expect(r.stdout).toMatch(/claude CLI/);
  });

  it("doctor does NOT require a running daemon (no AUTOVIRAL_WORK_ID)", async () => {
    // Unlike bridge commands, doctor must run client-side with zero daemon.
    const r = await execa("node", [BIN, "doctor"], {
      reject: false,
      env: { AUTOVIRAL_DATA_DIR: dataDir, FFMPEG_PATH: fakeFfmpeg, FFPROBE_PATH: fakeFfprobe },
    });
    // No "AUTOVIRAL_WORK_ID env not set" (exit 2) — it computed a table instead.
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toMatch(/WORK_ID/);
  });

  it("--help lists doctor + setup", async () => {
    const r = await execa("node", [BIN, "--help"], { reject: false });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/doctor/);
    expect(r.stdout).toMatch(/setup/);
  });
});

// ── UNIT: pure ffmpeg classifier (missing → non-ok) ──────────────────────────

describe("classifyFfmpeg — precedence + missing detection", () => {
  it("ffmpeg missing everywhere (no env/managed/vendored, not on PATH) → not ok", async () => {
    const { classifyFfmpeg } = await import("../src/deps-probe.js");
    const probe = classifyFfmpeg({
      name: "ffmpeg",
      override: undefined,
      managedPath: "/x/.autoviral/bin/ffmpeg",
      managedExists: false,
      vendoredPath: null,
      onPath: false,
    });
    expect(probe.source).toBe("path");
    expect(probe.ok).toBe(false);
  });

  it("env override wins → ok, source=env", async () => {
    const { classifyFfmpeg } = await import("../src/deps-probe.js");
    const probe = classifyFfmpeg({
      name: "ffprobe",
      override: "/opt/ffprobe",
      managedPath: "/x/bin/ffprobe",
      managedExists: true,
      vendoredPath: "/vendor/ffprobe",
      onPath: false,
    });
    expect(probe.source).toBe("env");
    expect(probe.path).toBe("/opt/ffprobe");
    expect(probe.ok).toBe(true);
  });

  it("falls through to vendored when no env/managed → ok, source=vendored", async () => {
    const { classifyFfmpeg } = await import("../src/deps-probe.js");
    const probe = classifyFfmpeg({
      name: "ffmpeg",
      override: undefined,
      managedPath: "/x/bin/ffmpeg",
      managedExists: false,
      vendoredPath: "/vendor/ffmpeg",
      onPath: false,
    });
    expect(probe.source).toBe("vendored");
    expect(probe.ok).toBe(true);
  });
});

// ── UNIT: installManagedFfmpeg (injected — no real copy) ──────────────────────

describe("installManagedFfmpeg — injected deps, no real install", () => {
  it("copies BOTH vendored binaries to the managed dir + reports progress", async () => {
    const { installManagedFfmpeg } = await import("../src/deps-probe.js");
    const lines: string[] = [];
    const copyFileFn = vi.fn(async () => {});
    const mkdirFn = vi.fn(async () => undefined as never);
    const chmodFn = vi.fn(async () => {});
    // vendored present, managed copy absent → both get copied.
    const res = await installManagedFfmpeg((l) => lines.push(l), {
      vendoredPathFor: (n) => `/vendor/${n}`,
      copyFileFn: copyFileFn as never,
      mkdirFn: mkdirFn as never,
      chmodFn: chmodFn as never,
      existsSyncFn: ((p: string) => p.startsWith("/vendor/")) as never,
    });
    expect(copyFileFn).toHaveBeenCalledTimes(2);
    expect(res.status).toBe("installed");
    // Progress was streamed (never a silent stall).
    expect(lines.some((l) => /copying vendored binary/.test(l))).toBe(true);
    expect(lines.some((l) => /installed/.test(l))).toBe(true);
  });

  it("idempotent: managed copies already present → no copy, status=already", async () => {
    const { installManagedFfmpeg } = await import("../src/deps-probe.js");
    const copyFileFn = vi.fn(async () => {});
    const res = await installManagedFfmpeg(() => {}, {
      vendoredPathFor: (n) => `/vendor/${n}`,
      copyFileFn: copyFileFn as never,
      mkdirFn: (async () => undefined) as never,
      chmodFn: (async () => {}) as never,
      // Everything "exists" → managed copies already there.
      existsSyncFn: (() => true) as never,
    });
    expect(copyFileFn).not.toHaveBeenCalled();
    expect(res.status).toBe("already");
  });

  it("no vendored binary → skipped (PATH fallback), never throws", async () => {
    const { installManagedFfmpeg } = await import("../src/deps-probe.js");
    const res = await installManagedFfmpeg(() => {}, {
      vendoredPathFor: () => null,
      copyFileFn: (async () => {}) as never,
      mkdirFn: (async () => undefined) as never,
      chmodFn: (async () => {}) as never,
      existsSyncFn: (() => false) as never,
    });
    expect(res.status).toBe("skipped");
  });
});

// ── UNIT: installTtsVenv (mock spawner — no real venv/pip) ────────────────────

describe("installTtsVenv — mock spawner, no real install", () => {
  let dataDir: string;
  beforeEach(() => {
    // Fresh empty data dir so probeTts().ready is false → the installer runs.
    dataDir = mkdtempSync(join(tmpdir(), "av-tts-"));
    process.env.AUTOVIRAL_DATA_DIR = dataDir;
  });

  it("runs python venv + pip install edge-tts stable-ts, streaming progress", async () => {
    const { installTtsVenv } = await import("../src/deps-probe.js");
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const lines: string[] = [];
    const spawner = vi.fn(async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return { code: 0, stdout: "", stderr: "" };
    });
    const res = await installTtsVenv((l) => lines.push(l), spawner as never);

    // python3 --version probe, then `python3 -m venv <dir>`, then pip install.
    expect(calls.some((c) => c.args.join(" ") === "--version")).toBe(true);
    expect(calls.some((c) => c.args[0] === "-m" && c.args[1] === "venv")).toBe(true);
    const pip = calls.find((c) => c.args.includes("pip"));
    expect(pip).toBeTruthy();
    expect(pip!.args).toContain("edge-tts");
    expect(pip!.args).toContain("stable-ts");
    expect(pip!.args).toContain("--upgrade");
    expect(res.status).toBe("installed");
    // Streamed something (no silent stall).
    expect(lines.length).toBeGreaterThan(0);
  });

  it("python3 absent (spawn error) → status=failed with an install hint, no throw", async () => {
    const { installTtsVenv } = await import("../src/deps-probe.js");
    const spawner = vi.fn(async () => {
      throw new Error("spawn python3 ENOENT");
    });
    const res = await installTtsVenv(() => {}, spawner as never);
    expect(res.status).toBe("failed");
    expect(res.detail).toMatch(/python3 not found/i);
  });

  it("pip failure → status=failed surfacing the exit code", async () => {
    const { installTtsVenv } = await import("../src/deps-probe.js");
    const spawner = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes("pip")) return { code: 1, stdout: "", stderr: "boom" };
      return { code: 0, stdout: "", stderr: "" };
    });
    const res = await installTtsVenv(() => {}, spawner as never);
    expect(res.status).toBe("failed");
    expect(res.detail).toMatch(/pip exited 1/);
  });

  afterAll(() => {
    delete process.env.AUTOVIRAL_DATA_DIR;
  });
});

// ── UNIT: setupCommand wiring (mock the install module) ──────────────────────

describe("setupCommand — wiring (install module mocked)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls installManagedFfmpeg + installTtsVenv with a progress reporter; skips playwright by default; exit 0", async () => {
    const installManagedFfmpeg = vi.fn(async (report: (l: string) => void) => {
      report("ffmpeg progress");
      return { status: "installed" as const, detail: "ok" };
    });
    const installTtsVenv = vi.fn(async (report: (l: string) => void) => {
      report("tts progress");
      return { status: "installed" as const, detail: "ok" };
    });
    const installPlaywrightChromium = vi.fn(async () => ({
      status: "installed" as const,
      detail: "ok",
    }));
    vi.doMock("../src/deps-probe.js", () => ({
      installManagedFfmpeg,
      installTtsVenv,
      installPlaywrightChromium,
    }));

    const { setupCommand } = await import("../src/commands/setup.js");
    const prevExit = process.exitCode;
    process.exitCode = undefined;
    await setupCommand([]);

    expect(installManagedFfmpeg).toHaveBeenCalledTimes(1);
    expect(typeof installManagedFfmpeg.mock.calls[0][0]).toBe("function"); // progress reporter
    expect(installTtsVenv).toHaveBeenCalledTimes(1);
    // Default (no --heavy) → playwright is NOT installed eagerly.
    expect(installPlaywrightChromium).not.toHaveBeenCalled();
    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);
    process.exitCode = prevExit;
  });

  it("--heavy → also installs playwright chromium", async () => {
    const installManagedFfmpeg = vi.fn(async () => ({ status: "installed" as const, detail: "ok" }));
    const installTtsVenv = vi.fn(async () => ({ status: "installed" as const, detail: "ok" }));
    const installPlaywrightChromium = vi.fn(async () => ({ status: "installed" as const, detail: "ok" }));
    vi.doMock("../src/deps-probe.js", () => ({
      installManagedFfmpeg,
      installTtsVenv,
      installPlaywrightChromium,
    }));

    const { setupCommand } = await import("../src/commands/setup.js");
    const prevExit = process.exitCode;
    process.exitCode = undefined;
    await setupCommand(["--heavy"]);
    expect(installPlaywrightChromium).toHaveBeenCalledTimes(1);
    process.exitCode = prevExit;
  });

  it("core ffmpeg install failure → exit code 1", async () => {
    const installManagedFfmpeg = vi.fn(async () => ({ status: "failed" as const, detail: "no disk" }));
    const installTtsVenv = vi.fn(async () => ({ status: "installed" as const, detail: "ok" }));
    const installPlaywrightChromium = vi.fn(async () => ({ status: "skipped" as const, detail: "" }));
    vi.doMock("../src/deps-probe.js", () => ({
      installManagedFfmpeg,
      installTtsVenv,
      installPlaywrightChromium,
    }));

    const { setupCommand } = await import("../src/commands/setup.js");
    const prevExit = process.exitCode;
    process.exitCode = undefined;
    await setupCommand([]);
    expect(process.exitCode).toBe(1);
    process.exitCode = prevExit;
  });
});

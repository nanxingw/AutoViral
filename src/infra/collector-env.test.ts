import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import type { Spawner } from "./python-env.js";

// collector-env.ts is the Douyin-collector sibling of python-env.ts: a SECOND
// managed venv (<dataDir>/collector-venv) that pip-installs f2 +
// browser_cookie3 — the dependency-bootstrap layer for the Douyin scrape
// rebuild (PRD-0006 S4, deep module D4 dependency layer). It reuses the exact
// venv/doctor/managed-bin mechanism v0.1.2 built for edge-tts, so the test
// idiom mirrors python-env.test.ts verbatim:
//   * the venv base is frozen on `dataDir` (= AUTOVIRAL_DATA_DIR) at module
//     load, so every case runs a fresh import under an isolated temp dataDir;
//   * the spawner is ALWAYS injected — these tests NEVER run a real
//     `python3 -m venv` or `pip install`, never touch PyPI.
// Honesty constraint (S4): assert collector readiness reports present-vs-missing
// correctly — no live network install needed to pass the green-gate.

type CollectorEnvModule = typeof import("./collector-env.js");

async function withFreshEnv<T>(
  fn: (env: CollectorEnvModule, dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "av-collector-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  vi.resetModules();
  try {
    const env = await import("./collector-env.js");
    return await fn(env, dir);
  } finally {
    delete process.env.AUTOVIRAL_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

const isWin = process.platform === "win32";

/** Absolute path of the venv's `f2` console-script for a given dataDir. */
function f2BinPath(dir: string): string {
  return isWin
    ? join(dir, "collector-venv", "Scripts", "f2.exe")
    : join(dir, "collector-venv", "bin", "f2");
}

/** Absolute path of the collector venv's python interpreter. */
function venvPyPath(dir: string): string {
  return isWin
    ? join(dir, "collector-venv", "Scripts", "python.exe")
    : join(dir, "collector-venv", "bin", "python3");
}

/** Absolute path of the browser_cookie3 site-packages dir for a given dataDir.
 *  POSIX path embeds the interpreter minor version; we use 3.12 in fixtures. */
function browserCookie3PkgPath(dir: string): string {
  return isWin
    ? join(dir, "collector-venv", "Lib", "site-packages", "browser_cookie3")
    : join(dir, "collector-venv", "lib", "python3.12", "site-packages", "browser_cookie3");
}

/** True when an arg list is the `import browser_cookie3` import-probe. */
function isImportProbe(args: string[]): boolean {
  return args.includes("-c") && args.some((a) => a.includes("import browser_cookie3"));
}

/** A spawner that records its calls and returns a fixed code per command. */
function recordingSpawner(plan: {
  pythonVersionCode?: number | null;
  pythonVersionError?: Error;
  venvCode?: number;
  pipCode?: number;
  /** Exit code of the `import browser_cookie3` probe (default 0 = importable). */
  importProbeCode?: number;
}) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const spawner: Spawner = async (cmd, args) => {
    calls.push({ cmd, args });
    if (args.includes("--version")) {
      if (plan.pythonVersionError) throw plan.pythonVersionError;
      return { code: plan.pythonVersionCode ?? 0, stdout: "Python 3.12.0\n", stderr: "" };
    }
    if (args.includes("venv")) {
      return { code: plan.venvCode ?? 0, stdout: "", stderr: plan.venvCode ? "venv boom" : "" };
    }
    if (isImportProbe(args)) {
      return { code: plan.importProbeCode ?? 0, stdout: "", stderr: "" };
    }
    if (args.includes("pip")) {
      return { code: plan.pipCode ?? 0, stdout: "", stderr: plan.pipCode ? "pip boom" : "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { calls, spawner };
}

describe("collector-env — path resolution (pure reads)", () => {
  it("resolves the collector venv dir + bin paths under AUTOVIRAL_DATA_DIR", async () => {
    await withFreshEnv(async (env, dir) => {
      expect(env.collectorVenvDir()).toBe(join(dir, "collector-venv"));
      const f2 = env.collectorVenvBinPath("f2");
      expect(isAbsolute(f2)).toBe(true);
      expect(f2).toBe(f2BinPath(dir));
    });
  });

  it("collectorVenvReady() needs BOTH f2 AND browser_cookie3: f2-only is still not ready", async () => {
    await withFreshEnv(async (env, dir) => {
      // Fresh dataDir → nothing provisioned.
      expect(env.collectorVenvReady()).toBe(false);

      // Only f2 present → NOT ready (the f2-before-cookie partial-provision state).
      const bin = f2BinPath(dir);
      await mkdir(join(bin, ".."), { recursive: true });
      await writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
      expect(env.collectorVenvReady()).toBe(false);

      // Add the browser_cookie3 package dir → both deps present → ready.
      await mkdir(browserCookie3PkgPath(dir), { recursive: true });
      expect(env.collectorVenvReady()).toBe(true);
    });
  });

  it("collectorVenvPythonPath() falls back to bare python3 when the venv is absent", async () => {
    await withFreshEnv(async (env) => {
      expect(env.collectorVenvPythonPath()).toBe("python3");
    });
  });

  it("collectorVenvPythonPath() resolves the venv interpreter once it exists", async () => {
    await withFreshEnv(async (env, dir) => {
      const py = venvPyPath(dir);
      await mkdir(join(py, ".."), { recursive: true });
      await writeFile(py, "#!/bin/sh\n", { mode: 0o755 });
      expect(env.collectorVenvPythonPath()).toBe(py);
    });
  });
});

describe("ensureCollectorVenv() — idempotent skip", () => {
  it("is a no-op (no spawn) when BOTH deps are already provisioned", async () => {
    await withFreshEnv(async (env, dir) => {
      // Pre-create f2 console-script AND browser_cookie3 pkg dir → fully
      // provisioned → collectorVenvReady() true.
      const bin = f2BinPath(dir);
      await mkdir(join(bin, ".."), { recursive: true });
      await writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
      await mkdir(browserCookie3PkgPath(dir), { recursive: true });

      const { calls, spawner } = recordingSpawner({});
      await env.ensureCollectorVenv({ spawner });
      // Already ready → never probed python3, never ran venv/pip.
      expect(calls).toEqual([]);
    });
  });
});

describe("ensureCollectorVenv() — f2-present / cookie-absent self-heal (regression)", () => {
  it("re-runs pip to back-fill browser_cookie3 when f2 exists but cookie is missing", async () => {
    await withFreshEnv(async (env, dir) => {
      // f2 console-script + venv interpreter present, but browser_cookie3 is NOT
      // in site-packages → collectorVenvReady() false → no short-circuit.
      const bin = f2BinPath(dir);
      await mkdir(join(bin, ".."), { recursive: true });
      await writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
      const py = venvPyPath(dir);
      await mkdir(join(py, ".."), { recursive: true });
      await writeFile(py, "#!/bin/sh\n", { mode: 0o755 });

      expect(env.collectorVenvReady()).toBe(false);

      // import-probe non-zero (browser_cookie3 not importable) → pip MUST fire.
      const { calls, spawner } = recordingSpawner({ importProbeCode: 1 });
      await env.ensureCollectorVenv({ spawner });

      expect(calls.some((c) => isImportProbe(c.args))).toBe(true);
      const pipCall = calls.find((c) => c.args.includes("pip"));
      expect(pipCall?.args).toEqual(
        expect.arrayContaining(["-m", "pip", "install", "--upgrade", "f2", "browser_cookie3"]),
      );
    });
  });

  it("skips the pip step when browser_cookie3 is already importable (no needless reinstall)", async () => {
    await withFreshEnv(async (env, dir) => {
      const bin = f2BinPath(dir);
      await mkdir(join(bin, ".."), { recursive: true });
      await writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
      const py = venvPyPath(dir);
      await mkdir(join(py, ".."), { recursive: true });
      await writeFile(py, "#!/bin/sh\n", { mode: 0o755 });

      const { calls, spawner } = recordingSpawner({ importProbeCode: 0 });
      await env.ensureCollectorVenv({ spawner });

      expect(calls.some((c) => isImportProbe(c.args))).toBe(true);
      expect(calls.some((c) => c.args.includes("pip"))).toBe(false);
    });
  });
});

describe("ensureCollectorVenv() — full provision path", () => {
  it("probes python3, creates the venv, then pip-installs f2 + browser_cookie3", async () => {
    await withFreshEnv(async (env) => {
      // Fresh venv has no browser_cookie3 → import-probe fails → pip must run.
      const { calls, spawner } = recordingSpawner({ importProbeCode: 1 });
      await env.ensureCollectorVenv({ spawner });

      // Order: python3 --version → python3 -m venv <dir> → <venvpy> -m pip install …
      expect(calls[0]).toMatchObject({ cmd: "python3", args: ["--version"] });
      const venvCall = calls.find((c) => c.args.includes("venv"));
      expect(venvCall?.cmd).toBe("python3");
      const pipCall = calls.find((c) => c.args.includes("pip"));
      expect(pipCall?.args).toEqual(
        expect.arrayContaining(["-m", "pip", "install", "--upgrade", "f2", "browser_cookie3"]),
      );
    });
  });

  it("throws a wrapped error when pip install fails", async () => {
    await withFreshEnv(async (env) => {
      const { spawner } = recordingSpawner({ importProbeCode: 1, pipCode: 1 });
      await expect(env.ensureCollectorVenv({ spawner })).rejects.toThrow(/f2\/browser_cookie3/);
    });
  });

  it("throws a wrapped error when venv creation fails", async () => {
    await withFreshEnv(async (env) => {
      const { spawner } = recordingSpawner({ venvCode: 1 });
      await expect(env.ensureCollectorVenv({ spawner })).rejects.toThrow(/venv/i);
    });
  });
});

describe("ensureCollectorVenv() — missing python3 error path", () => {
  it("throws PythonMissingError when `python3 --version` ENOENTs", async () => {
    await withFreshEnv(async (env) => {
      const enoent = Object.assign(new Error("spawn python3 ENOENT"), { code: "ENOENT" });
      const { spawner } = recordingSpawner({ pythonVersionError: enoent });
      await expect(env.ensureCollectorVenv({ spawner })).rejects.toBeInstanceOf(
        env.PythonMissingError,
      );
    });
  });

  it("throws PythonMissingError when `python3 --version` exits non-zero", async () => {
    await withFreshEnv(async (env) => {
      const { spawner } = recordingSpawner({ pythonVersionCode: 127 });
      const err = await env.ensureCollectorVenv({ spawner }).catch((e) => e);
      expect(err).toBeInstanceOf(env.PythonMissingError);
      expect(err.errorCode).toBe("PYTHON_DEP_MISSING");
    });
  });

  it("does NOT proceed to venv/pip once python3 is missing", async () => {
    await withFreshEnv(async (env) => {
      const enoent = Object.assign(new Error("spawn python3 ENOENT"), { code: "ENOENT" });
      const { calls, spawner } = recordingSpawner({ pythonVersionError: enoent });
      await env.ensureCollectorVenv({ spawner }).catch(() => {});
      expect(calls.some((c) => c.args.includes("venv"))).toBe(false);
      expect(calls.some((c) => c.args.includes("pip"))).toBe(false);
    });
  });
});

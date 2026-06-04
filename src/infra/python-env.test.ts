import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import type { Spawner } from "./python-env.js";

// python-env.ts freezes the venv base on `dataDir` (= AUTOVIRAL_DATA_DIR) at
// module load (via config.ts). Every test runs a fresh import inside an
// isolated temp dataDir so the venv path, the in-flight guard, and any
// filesystem state never leak between cases. Mirrors deps.test.ts's idiom.
//
// The spawner is ALWAYS injected — these tests never run a real `python3 -m
// venv` or `pip install` or `playwright install`.

type PyEnvModule = typeof import("./python-env.js");

async function withFreshEnv<T>(fn: (env: PyEnvModule, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "av-pyenv-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  vi.resetModules();
  try {
    const env = await import("./python-env.js");
    return await fn(env, dir);
  } finally {
    delete process.env.AUTOVIRAL_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

const isWin = process.platform === "win32";

/** Absolute path of the venv's edge-tts console-script for a given dataDir. */
function edgeTtsBinPath(dir: string): string {
  return isWin
    ? join(dir, "tts-venv", "Scripts", "edge-tts.exe")
    : join(dir, "tts-venv", "bin", "edge-tts");
}

/** Absolute path of the venv's python interpreter for a given dataDir. */
function venvPyPath(dir: string): string {
  return isWin
    ? join(dir, "tts-venv", "Scripts", "python.exe")
    : join(dir, "tts-venv", "bin", "python3");
}

/** Absolute path of the stable_whisper site-packages dir for a given dataDir.
 *  POSIX path embeds the interpreter minor version; we use 3.12 in fixtures. */
function stableWhisperPkgPath(dir: string): string {
  return isWin
    ? join(dir, "tts-venv", "Lib", "site-packages", "stable_whisper")
    : join(dir, "tts-venv", "lib", "python3.12", "site-packages", "stable_whisper");
}

/** True when an arg list is the `import stable_whisper` import-probe. */
function isImportProbe(args: string[]): boolean {
  return args.includes("-c") && args.some((a) => a.includes("import stable_whisper"));
}

/** A spawner that records its calls and returns a fixed code per command. */
function recordingSpawner(plan: {
  pythonVersionCode?: number | null;
  pythonVersionError?: Error;
  venvCode?: number;
  pipCode?: number;
  pwCode?: number;
  /** Exit code of the `import stable_whisper` probe (default 0 = importable). */
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
    if (args.includes("install") && args.includes("chromium")) {
      return { code: plan.pwCode ?? 0, stdout: "downloading 100%", stderr: plan.pwCode ? "pw boom" : "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { calls, spawner };
}

describe("python-env — path resolution (pure reads)", () => {
  it("resolves the venv dir + bin paths under AUTOVIRAL_DATA_DIR", async () => {
    await withFreshEnv(async (env, dir) => {
      expect(env.ttsVenvDir()).toBe(join(dir, "tts-venv"));
      const edge = env.venvBinPath("edge-tts");
      expect(isAbsolute(edge)).toBe(true);
      expect(edge).toBe(edgeTtsBinPath(dir));
    });
  });

  it("ttsVenvReady() needs BOTH edge-tts AND stable-ts: edge-only is still not ready", async () => {
    await withFreshEnv(async (env, dir) => {
      expect(env.ttsVenvReady()).toBe(false);

      // Only edge-tts present → NOT ready (the live-reproduced edge-only state).
      const bin = edgeTtsBinPath(dir);
      await mkdir(join(bin, ".."), { recursive: true });
      await writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
      expect(env.ttsVenvReady()).toBe(false);

      // Add the stable_whisper package dir → both deps present → ready.
      await mkdir(stableWhisperPkgPath(dir), { recursive: true });
      expect(env.ttsVenvReady()).toBe(true);
    });
  });

  it("venvPythonPath() falls back to bare python3 when the venv is absent", async () => {
    await withFreshEnv(async (env) => {
      expect(env.venvPythonPath()).toBe("python3");
    });
  });

  it("venvPythonPath() resolves the venv interpreter once it exists", async () => {
    await withFreshEnv(async (env, dir) => {
      const py = isWin
        ? join(dir, "tts-venv", "Scripts", "python.exe")
        : join(dir, "tts-venv", "bin", "python3");
      await mkdir(join(py, ".."), { recursive: true });
      await writeFile(py, "#!/bin/sh\n", { mode: 0o755 });
      expect(env.venvPythonPath()).toBe(py);
    });
  });
});

describe("ensureTtsVenv() — idempotent skip", () => {
  it("is a no-op (no spawn) when BOTH deps are already provisioned", async () => {
    await withFreshEnv(async (env, dir) => {
      // Pre-create edge-tts console-script AND stable_whisper pkg dir → fully
      // provisioned → ttsVenvReady() true.
      const bin = edgeTtsBinPath(dir);
      await mkdir(join(bin, ".."), { recursive: true });
      await writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
      await mkdir(stableWhisperPkgPath(dir), { recursive: true });

      const { calls, spawner } = recordingSpawner({});
      await env.ensureTtsVenv({ spawner });
      // Already ready → never probed python3, never ran venv/pip.
      expect(calls).toEqual([]);
    });
  });
});

describe("ensureTtsVenv() — edge-present / stable-absent self-heal (regression)", () => {
  it("re-runs pip to back-fill stable-ts when edge-tts exists but stable-ts is missing", async () => {
    await withFreshEnv(async (env, dir) => {
      // Reproduce the live machine state: edge-tts console-script present AND
      // the venv interpreter present, but the stable_whisper package is NOT in
      // site-packages. ttsVenvReady() must be false, so ensureTtsVenv() does
      // NOT short-circuit "already provisioned".
      const bin = edgeTtsBinPath(dir);
      await mkdir(join(bin, ".."), { recursive: true });
      await writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
      const py = venvPyPath(dir);
      await mkdir(join(py, ".."), { recursive: true });
      await writeFile(py, "#!/bin/sh\n", { mode: 0o755 });

      expect(env.ttsVenvReady()).toBe(false);

      // The import-probe returns non-zero (stable_whisper not importable), so
      // the pip step MUST fire even though edge-tts already exists.
      const { calls, spawner } = recordingSpawner({ importProbeCode: 1 });
      await env.ensureTtsVenv({ spawner });

      // The authoritative import-probe ran…
      expect(calls.some((c) => isImportProbe(c.args))).toBe(true);
      // …and because it failed, pip --upgrade fired to back-fill stable-ts.
      const pipCall = calls.find((c) => c.args.includes("pip"));
      expect(pipCall?.args).toEqual(
        expect.arrayContaining(["-m", "pip", "install", "--upgrade", "edge-tts", "stable-ts"]),
      );
    });
  });

  it("skips the pip step when stable-ts is already importable (no needless reinstall)", async () => {
    await withFreshEnv(async (env, dir) => {
      // edge-tts + venv python present; stable-ts site-packages dir absent so
      // ttsVenvReady() is false and we don't short-circuit — but the import-
      // probe reports stable_whisper IS importable, so pip must NOT re-run.
      const bin = edgeTtsBinPath(dir);
      await mkdir(join(bin, ".."), { recursive: true });
      await writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
      const py = venvPyPath(dir);
      await mkdir(join(py, ".."), { recursive: true });
      await writeFile(py, "#!/bin/sh\n", { mode: 0o755 });

      const { calls, spawner } = recordingSpawner({ importProbeCode: 0 });
      await env.ensureTtsVenv({ spawner });

      expect(calls.some((c) => isImportProbe(c.args))).toBe(true);
      expect(calls.some((c) => c.args.includes("pip"))).toBe(false);
    });
  });
});

describe("ensureTtsVenv() — full provision path", () => {
  it("probes python3, creates the venv, then pip-installs edge-tts + stable-ts", async () => {
    await withFreshEnv(async (env) => {
      // Fresh venv has no stable-ts → import-probe fails → pip must run.
      const { calls, spawner } = recordingSpawner({ importProbeCode: 1 });
      await env.ensureTtsVenv({ spawner });

      // Order: python3 --version → python3 -m venv <dir> → <venvpy> -m pip install …
      expect(calls[0]).toMatchObject({ cmd: "python3", args: ["--version"] });
      const venvCall = calls.find((c) => c.args.includes("venv"));
      expect(venvCall?.cmd).toBe("python3");
      const pipCall = calls.find((c) => c.args.includes("pip"));
      expect(pipCall?.args).toEqual(
        expect.arrayContaining(["-m", "pip", "install", "--upgrade", "edge-tts", "stable-ts"]),
      );
    });
  });

  it("throws a wrapped error when pip install fails", async () => {
    await withFreshEnv(async (env) => {
      const { spawner } = recordingSpawner({ importProbeCode: 1, pipCode: 1 });
      await expect(env.ensureTtsVenv({ spawner })).rejects.toThrow(/edge-tts\/stable-ts/);
    });
  });

  it("throws a wrapped error when venv creation fails", async () => {
    await withFreshEnv(async (env) => {
      const { spawner } = recordingSpawner({ venvCode: 1 });
      await expect(env.ensureTtsVenv({ spawner })).rejects.toThrow(/venv/i);
    });
  });
});

describe("ensureTtsVenv() — missing python3 error path", () => {
  it("throws PythonMissingError when `python3 --version` ENOENTs", async () => {
    await withFreshEnv(async (env) => {
      const enoent = Object.assign(new Error("spawn python3 ENOENT"), { code: "ENOENT" });
      const { spawner } = recordingSpawner({ pythonVersionError: enoent });
      await expect(env.ensureTtsVenv({ spawner })).rejects.toBeInstanceOf(env.PythonMissingError);
    });
  });

  it("throws PythonMissingError when `python3 --version` exits non-zero", async () => {
    await withFreshEnv(async (env) => {
      const { spawner } = recordingSpawner({ pythonVersionCode: 127 });
      const err = await env.ensureTtsVenv({ spawner }).catch((e) => e);
      expect(err).toBeInstanceOf(env.PythonMissingError);
      expect(err.errorCode).toBe("PYTHON_DEP_MISSING");
    });
  });

  it("does NOT proceed to venv/pip once python3 is missing", async () => {
    await withFreshEnv(async (env) => {
      const enoent = Object.assign(new Error("spawn python3 ENOENT"), { code: "ENOENT" });
      const { calls, spawner } = recordingSpawner({ pythonVersionError: enoent });
      await env.ensureTtsVenv({ spawner }).catch(() => {});
      expect(calls.some((c) => c.args.includes("venv"))).toBe(false);
      expect(calls.some((c) => c.args.includes("pip"))).toBe(false);
    });
  });
});

describe("ensurePlaywrightChromium() — lazy install + progress", () => {
  // Point PLAYWRIGHT_BROWSERS_PATH at a guaranteed-empty temp dir so the cache
  // short-circuit doesn't fire (and the real host cache never leaks in).
  async function withEmptyBrowserCache<T>(fn: () => Promise<T>): Promise<T> {
    const cacheDir = await mkdtemp(join(tmpdir(), "av-pw-cache-"));
    const prev = process.env.PLAYWRIGHT_BROWSERS_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH = cacheDir;
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
      else process.env.PLAYWRIGHT_BROWSERS_PATH = prev;
      await rm(cacheDir, { recursive: true, force: true });
    }
  }

  it("runs `playwright install chromium` and surfaces progress lines", async () => {
    await withFreshEnv(async (env) => {
      await withEmptyBrowserCache(async () => {
        const { calls, spawner } = recordingSpawner({});
        const progress: string[] = [];
        await env.ensurePlaywrightChromium({ spawner, onProgress: (l) => progress.push(l) });

        // The install ran with `install chromium` (the CLI is resolved to an
        // absolute bundled path, so we assert the stable trailing args, not the
        // bare `playwright` literal which only the npx fallback emits).
        const installCall = calls.find((c) => c.args.includes("chromium"));
        expect(installCall?.args).toEqual(
          expect.arrayContaining(["install", "chromium"]),
        );
        // Caller-visible progress: at minimum the start + ready bookends fired.
        expect(progress.some((l) => /ensuring chromium/.test(l))).toBe(true);
        expect(progress.some((l) => /ready/.test(l))).toBe(true);
      });
    });
  });

  it("short-circuits (no spawn) when a chromium build is already cached", async () => {
    await withFreshEnv(async (env) => {
      await withEmptyBrowserCache(async () => {
        // Drop a chromium-<build> dir into the cache so chromiumCached() is true.
        const cacheDir = process.env.PLAYWRIGHT_BROWSERS_PATH!;
        await mkdir(join(cacheDir, "chromium-1097"), { recursive: true });

        const { calls, spawner } = recordingSpawner({});
        const progress: string[] = [];
        await env.ensurePlaywrightChromium({ spawner, onProgress: (l) => progress.push(l) });

        // Cache hit → no install spawn at all.
        expect(calls).toEqual([]);
        expect(progress.some((l) => /already cached/.test(l))).toBe(true);
      });
    });
  });

  it("throws when the install exits non-zero", async () => {
    await withFreshEnv(async (env) => {
      await withEmptyBrowserCache(async () => {
        const { spawner } = recordingSpawner({ pwCode: 1 });
        await expect(env.ensurePlaywrightChromium({ spawner })).rejects.toThrow(/chromium failed/);
      });
    });
  });
});

describe("whisperModelLazyDownloadNote()", () => {
  it("documents that the model downloads on first ASR use, not at boot", async () => {
    await withFreshEnv(async (env) => {
      expect(env.whisperModelLazyDownloadNote()).toMatch(/first ASR use/);
      expect(env.whisperModelLazyDownloadNote()).toMatch(/not provisioned at install\/boot/);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute, basename } from "node:path";

// deps.ts freezes the managed-bin base on `dataDir` (= AUTOVIRAL_DATA_DIR) at
// module load (via config.ts), and memoises path resolution. Every test runs a
// fresh import inside an isolated temp dataDir so the managed dir, the cache and
// the env overrides never leak between cases. Mirrors api.agent-model.test idiom.

type DepsModule = typeof import("./deps.js");

/** Set AUTOVIRAL_DATA_DIR to a fresh temp dir, reset the module graph, import
 *  a pristine deps.js, run `fn`, then clean up. */
async function withFreshDeps<T>(fn: (deps: DepsModule, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "av-deps-"));
  process.env.AUTOVIRAL_DATA_DIR = dir;
  vi.resetModules();
  try {
    const deps = await import("./deps.js");
    return await fn(deps, dir);
  } finally {
    delete process.env.AUTOVIRAL_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

const exe = process.platform === "win32" ? ".exe" : "";

describe("deps resolver — precedence (env > managed > vendored > path)", () => {
  const savedFfmpegPath = process.env.FFMPEG_PATH;
  const savedFfprobePath = process.env.FFPROBE_PATH;
  beforeEach(() => {
    delete process.env.FFMPEG_PATH;
    delete process.env.FFPROBE_PATH;
  });
  afterEach(() => {
    if (savedFfmpegPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = savedFfmpegPath;
    if (savedFfprobePath === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = savedFfprobePath;
  });

  it("with no managed copy and no env override, resolves the VENDORED absolute path", async () => {
    await withFreshDeps(async (deps) => {
      const ffmpeg = deps.getFfmpegPath();
      const ffprobe = deps.getFfprobePath();
      // The whole point of the slice: these are absolute paths into node_modules,
      // not the bare names — so they work without any system install.
      expect(isAbsolute(ffmpeg)).toBe(true);
      expect(isAbsolute(ffprobe)).toBe(true);
      expect(basename(ffmpeg).startsWith("ffmpeg")).toBe(true);
      expect(basename(ffprobe).startsWith("ffprobe")).toBe(true);

      const d = deps.detect();
      expect(d.ffmpeg.source).toBe("vendored");
      expect(d.ffprobe.source).toBe("vendored");
    });
  });

  it("prefers the MANAGED copy over the vendored path once it exists", async () => {
    await withFreshDeps(async (deps, dir) => {
      const managed = join(dir, "bin", `ffmpeg${exe}`);
      await mkdir(join(dir, "bin"), { recursive: true });
      await writeFile(managed, "#!/bin/sh\n", { mode: 0o755 });

      const d = deps.detect();
      expect(d.ffmpeg.source).toBe("managed");
      expect(d.ffmpeg.path).toBe(managed);
      expect(d.ffmpeg.managedExists).toBe(true);

      // detect() is fresh; getFfmpegPath() caches, so reset before asserting it.
      deps._resetDepsCacheForTests();
      expect(deps.getFfmpegPath()).toBe(managed);
    });
  });

  it("prefers the ENV override above everything (managed + vendored)", async () => {
    await withFreshDeps(async (deps, dir) => {
      // Even with a managed copy present, FFMPEG_PATH wins.
      const managed = join(dir, "bin", `ffmpeg${exe}`);
      await mkdir(join(dir, "bin"), { recursive: true });
      await writeFile(managed, "#!/bin/sh\n", { mode: 0o755 });

      process.env.FFMPEG_PATH = "/opt/custom/ffmpeg";
      const d = deps.detect();
      expect(d.ffmpeg.source).toBe("env");
      expect(d.ffmpeg.path).toBe("/opt/custom/ffmpeg");
    });
  });

  it("a blank/whitespace env override is ignored (falls back to lower tiers)", async () => {
    await withFreshDeps(async (deps) => {
      process.env.FFPROBE_PATH = "   ";
      const d = deps.detect();
      expect(d.ffprobe.source).not.toBe("env");
      expect(d.ffprobe.source).toBe("vendored");
    });
  });
});

describe("deps resolver — usable under a STRIPPED PATH (the tracer)", () => {
  const savedPath = process.env.PATH;
  afterEach(() => {
    process.env.PATH = savedPath;
  });

  it("returns an absolute, on-disk binary even when PATH is empty", async () => {
    await withFreshDeps(async (deps) => {
      // Simulate the non-login-shell launch: no /opt/homebrew/bin, no PATH at all.
      process.env.PATH = "";
      const ffmpeg = deps.getFfmpegPath();
      const ffprobe = deps.getFfprobePath();
      // A bare "ffmpeg" would be unfindable here; the vendored absolute path is.
      expect(isAbsolute(ffmpeg)).toBe(true);
      expect(isAbsolute(ffprobe)).toBe(true);
      expect(existsSync(ffmpeg)).toBe(true);
      expect(existsSync(ffprobe)).toBe(true);
    });
  });
});

describe("ensureManaged() — best-effort + idempotent", () => {
  it("copies the vendored binaries into ~/.autoviral/bin and is re-runnable", async () => {
    await withFreshDeps(async (deps, dir) => {
      const binDir = join(dir, "bin");
      expect(existsSync(binDir)).toBe(false);

      await deps.ensureManaged();

      const ffmpegManaged = join(binDir, `ffmpeg${exe}`);
      const ffprobeManaged = join(binDir, `ffprobe${exe}`);
      expect(existsSync(ffmpegManaged)).toBe(true);
      expect(existsSync(ffprobeManaged)).toBe(true);

      if (process.platform !== "win32") {
        const m = await stat(ffmpegManaged);
        // Owner-executable bit set so the managed copy is spawnable.
        expect(m.mode & 0o100).toBe(0o100);
      }

      // Idempotent: a second call neither throws nor duplicates files.
      const before = (await readdir(binDir)).sort();
      await expect(deps.ensureManaged()).resolves.toBeUndefined();
      const after = (await readdir(binDir)).sort();
      expect(after).toEqual(before);
    });
  });

  it("after ensureManaged(), resolution flips to the managed tier", async () => {
    await withFreshDeps(async (deps, dir) => {
      // Before: vendored.
      expect(deps.detect().ffmpeg.source).toBe("vendored");

      await deps.ensureManaged();

      // After: the managed copy exists, so a fresh resolution uses it.
      deps._resetDepsCacheForTests();
      const managed = join(dir, "bin", `ffmpeg${exe}`);
      expect(deps.detect().ffmpeg.source).toBe("managed");
      expect(deps.getFfmpegPath()).toBe(managed);
    });
  });
});

describe("detect() — diagnostics shape for the doctor (I14)", () => {
  it("reports managedPath + managedExists + vendoredPath for both binaries", async () => {
    await withFreshDeps(async (deps, dir) => {
      const d = deps.detect();
      for (const name of ["ffmpeg", "ffprobe"] as const) {
        expect(d[name].managedPath).toBe(join(dir, "bin", `${name}${exe}`));
        expect(d[name].managedExists).toBe(false);
        // Vendored packages are present in node_modules → an absolute path.
        expect(d[name].vendoredPath).not.toBeNull();
        expect(isAbsolute(d[name].vendoredPath!)).toBe(true);
      }
    });
  });
});

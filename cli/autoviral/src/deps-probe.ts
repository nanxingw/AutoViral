// CLI-local dependency probe + installer — backs `autoviral doctor` / `setup`
// (I14, PRD-0003 §1).
//
// WHY a CLI-local copy instead of importing src/infra/deps.ts + python-env.ts:
// the `autoviral` binary is a self-contained tsup bundle (see package.json) with
// `yaml` as its ONLY external runtime dep. src/infra/config.ts (which deps.ts +
// python-env.ts import for `dataDir`) pulls in js-yaml + dotenv and runs
// `dotenv.config()` as an import side-effect — bundling that into the agent CLI
// would bloat it and fire env side-effects on every `autoviral whoami`. doctor /
// setup also run CLIENT-SIDE (pure local filesystem probes, no daemon needed),
// so they don't need the server's module graph at all.
//
// This module therefore re-implements the DOCUMENTED resolution contract of
// src/infra/deps.ts (env → managed → vendored → PATH) and src/infra/python-env.ts
// (tts-venv layout, playwright cache) as small pure-read probes, plus the
// matching install primitives (copy vendored ffmpeg → managed; venv + pip;
// playwright install). The contracts are frozen in those modules' doc comments;
// keep this file in lockstep if they change.

import { existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, chmod } from "node:fs/promises";
import { spawn, type SpawnOptions } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const require = createRequire(import.meta.url);

// ── data dir (mirrors src/infra/config.ts) ───────────────────────────────────

/** ~/.autoviral, honouring AUTOVIRAL_DATA_DIR so tests stay isolated. Matches
 *  config.ts's CONFIG_DIR contract exactly. */
export function dataDir(): string {
  return process.env.AUTOVIRAL_DATA_DIR ?? join(homedir(), ".autoviral");
}

function exeName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

// ── ffmpeg / ffprobe (mirrors src/infra/deps.ts resolution) ──────────────────

export type DepSource = "env" | "managed" | "vendored" | "path";

export interface FfmpegProbe {
  name: "ffmpeg" | "ffprobe";
  /** Resolved invocation string the daemon would spawn. */
  path: string;
  /** Which precedence tier produced it. "path" = bare name on $PATH (risky). */
  source: DepSource;
  /** Managed copy under ~/.autoviral/bin (whether or not it exists yet). */
  managedPath: string;
  managedExists: boolean;
  /** Vendored absolute path (ffmpeg-static / @ffprobe-installer), or null. */
  vendoredPath: string | null;
  /** When source is "path", whether the bare name actually resolves on $PATH. */
  onPath: boolean;
  /** True when this binary can be spawned at all (env/managed/vendored, or a
   *  real PATH hit). */
  ok: boolean;
}

function managedPathFor(name: "ffmpeg" | "ffprobe"): string {
  return join(dataDir(), "bin", exeName(name));
}

function envOverride(name: "ffmpeg" | "ffprobe"): string | undefined {
  const v = name === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  return v && v.trim() ? v : undefined;
}

/** Resolve the vendored absolute path the same way src/infra/deps.ts does.
 *  ffmpeg-static default-exports the path string; @ffprobe-installer exports
 *  { path }. Wrapped so a missing/broken vendored package never throws. */
export function vendoredPathFor(name: "ffmpeg" | "ffprobe"): string | null {
  try {
    if (name === "ffmpeg") {
      const p = require("ffmpeg-static") as string | null;
      return p && typeof p === "string" ? p : null;
    }
    const mod = require("@ffprobe-installer/ffprobe") as { path?: string } | null;
    return mod && typeof mod.path === "string" ? mod.path : null;
  } catch {
    return null;
  }
}

/** Is `name` resolvable as a bare command on the current $PATH? Pure read — a
 *  cheap synchronous existsSync sweep, no spawn (so doctor never blocks). */
function resolvesOnPath(name: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      if (existsSync(join(dir, `${name}${ext}`))) return true;
    }
  }
  return false;
}

/** Inputs to the ffmpeg/ffprobe classification — separated from I/O so the
 *  precedence logic is unit-testable without faking native modules / the FS. */
export interface FfmpegInputs {
  name: "ffmpeg" | "ffprobe";
  override?: string;
  managedPath: string;
  managedExists: boolean;
  vendoredPath: string | null;
  /** Whether the bare name resolves on $PATH (only consulted at the PATH tier). */
  onPath: boolean;
}

/** Pure precedence resolver — env → managed → vendored → PATH. Mirrors
 *  src/infra/deps.ts.computeResolution() exactly. */
export function classifyFfmpeg(inputs: FfmpegInputs): FfmpegProbe {
  const { name, override, managedPath, managedExists, vendoredPath } = inputs;
  let path: string;
  let source: DepSource;
  if (override && override.trim()) {
    path = override;
    source = "env";
  } else if (managedExists) {
    path = managedPath;
    source = "managed";
  } else if (vendoredPath) {
    path = vendoredPath;
    source = "vendored";
  } else {
    path = name;
    source = "path";
  }
  const onPath = source === "path" ? inputs.onPath : true;
  // env/managed/vendored always spawnable; bare-name only if it's really on PATH.
  const ok = source !== "path" || onPath;
  return { name, path, source, managedPath, managedExists, vendoredPath, onPath, ok };
}

function probeFfmpeg(name: "ffmpeg" | "ffprobe"): FfmpegProbe {
  return classifyFfmpeg({
    name,
    override: envOverride(name),
    managedPath: managedPathFor(name),
    managedExists: existsSync(managedPathFor(name)),
    vendoredPath: vendoredPathFor(name),
    onPath: resolvesOnPath(name),
  });
}

/** Pure-read diagnostics for both core binaries (no caching). */
export function probeFfmpegBoth(): { ffmpeg: FfmpegProbe; ffprobe: FfmpegProbe } {
  return { ffmpeg: probeFfmpeg("ffmpeg"), ffprobe: probeFfmpeg("ffprobe") };
}

// ── tts venv (mirrors src/infra/python-env.ts) ───────────────────────────────

export interface TtsProbe {
  /** edge-tts console-script present in the venv. */
  edgeTts: boolean;
  /** stable-ts (import alias stable_whisper) package present in the venv. */
  stableTs: boolean;
  /** Both deps present → ttsVenvReady() equivalent. */
  ready: boolean;
  venvDir: string;
}

function ttsVenvDir(): string {
  return join(dataDir(), "tts-venv");
}

function venvBinPath(name: string): string {
  if (process.platform === "win32") {
    return join(ttsVenvDir(), "Scripts", `${name}.exe`);
  }
  return join(ttsVenvDir(), "bin", name);
}

function stableTsPresent(): boolean {
  const root = ttsVenvDir();
  if (process.platform === "win32") {
    return existsSync(join(root, "Lib", "site-packages", "stable_whisper"));
  }
  const libDir = join(root, "lib");
  let entries: string[];
  try {
    entries = readdirSync(libDir);
  } catch {
    return false;
  }
  for (const e of entries) {
    if (!e.startsWith("python")) continue;
    if (existsSync(join(libDir, e, "site-packages", "stable_whisper"))) return true;
  }
  return false;
}

export function probeTts(): TtsProbe {
  const edgeTts = existsSync(venvBinPath("edge-tts"));
  const stableTs = stableTsPresent();
  return { edgeTts, stableTs, ready: edgeTts && stableTs, venvDir: ttsVenvDir() };
}

// ── playwright chromium cache (mirrors src/infra/python-env.ts) ──────────────

export interface PlaywrightProbe {
  cached: boolean;
  cacheDir: string;
}

function playwrightBrowsersCacheDir(): string {
  const override = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (override && override.trim()) return override;
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(base, "ms-playwright");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "ms-playwright");
  }
  const xdg = process.env.XDG_CACHE_HOME;
  return join(xdg && xdg.trim() ? xdg : join(homedir(), ".cache"), "ms-playwright");
}

export function probePlaywright(): PlaywrightProbe {
  const cacheDir = playwrightBrowsersCacheDir();
  let cached = false;
  try {
    cached = readdirSync(cacheDir).some((e) => e.startsWith("chromium"));
  } catch {
    cached = false;
  }
  return { cached, cacheDir };
}

// ── claude CLI (cannot be bundled — detect + report only) ────────────────────

export interface ClaudeProbe {
  /** Absolute path to the resolved `claude` binary on $PATH, or null. */
  path: string | null;
  present: boolean;
}

export function probeClaude(): ClaudeProbe {
  const pathEnv = process.env.PATH ?? "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const cand = join(dir, `claude${ext}`);
      if (existsSync(cand)) return { path: cand, present: true };
    }
  }
  return { path: null, present: false };
}

// ── install primitives (used by `autoviral setup`) ───────────────────────────

/** Stream-friendly progress sink so setup never silently stalls. */
export type ProgressReporter = (line: string) => void;

/** Run a command, capturing exit + stdio, optionally streaming each line to a
 *  progress reporter. Injectable so setup tests never run a real venv/pip. */
export type Spawner = (
  cmd: string,
  args: string[],
  opts?: SpawnOptions & { onLine?: ProgressReporter },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export const realSpawner: Spawner = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const { onLine, ...sopts } = opts ?? {};
    const child = spawn(cmd, args, { ...sopts });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      onLine?.(s.trimEnd());
    });
    child.stderr?.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      onLine?.(s.trimEnd());
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

export interface InstallResult {
  /** Human-readable lines for the doctor-style summary after setup. */
  status: "installed" | "already" | "skipped" | "failed";
  detail: string;
}

/**
 * Copy the vendored ffmpeg/ffprobe binaries into ~/.autoviral/bin — the same
 * managed-location contract src/infra/deps.ts.ensureManaged() populates at
 * daemon boot, replicated here so `autoviral setup` lands them eagerly without a
 * running daemon. Idempotent (skips an existing copy); never throws.
 */
export async function installManagedFfmpeg(
  report: ProgressReporter,
  deps: {
    vendoredPathFor?: (n: "ffmpeg" | "ffprobe") => string | null;
    copyFileFn?: typeof copyFile;
    mkdirFn?: typeof mkdir;
    chmodFn?: typeof chmod;
    existsSyncFn?: typeof existsSync;
  } = {},
): Promise<InstallResult> {
  const vendored = deps.vendoredPathFor ?? vendoredPathFor;
  const cp = deps.copyFileFn ?? copyFile;
  const mk = deps.mkdirFn ?? mkdir;
  const ch = deps.chmodFn ?? chmod;
  const exists = deps.existsSyncFn ?? existsSync;

  const dir = join(dataDir(), "bin");
  try {
    await mk(dir, { recursive: true });
  } catch (e) {
    return { status: "failed", detail: `could not create ${dir}: ${errMsg(e)}` };
  }

  let copied = 0;
  let alreadyThere = 0;
  let missingVendor = 0;
  for (const name of ["ffmpeg", "ffprobe"] as const) {
    const dest = join(dir, exeName(name));
    if (exists(dest)) {
      alreadyThere++;
      report(`  ${name}: already managed (${dest})`);
      continue;
    }
    const src = vendored(name);
    if (!src || !exists(src)) {
      missingVendor++;
      report(`  ${name}: no vendored binary to copy (falls back to PATH at runtime)`);
      continue;
    }
    try {
      report(`  ${name}: copying vendored binary → ${dest} …`);
      await cp(src, dest);
      if (process.platform !== "win32") await ch(dest, 0o755);
      copied++;
      report(`  ${name}: installed.`);
    } catch (e) {
      report(`  ${name}: copy failed (${errMsg(e)}) — runtime falls back to vendored path`);
    }
  }

  if (copied > 0) {
    return { status: "installed", detail: `${copied} binary(ies) copied to ${dir}` };
  }
  if (alreadyThere === 2) {
    return { status: "already", detail: `ffmpeg + ffprobe already managed in ${dir}` };
  }
  if (missingVendor > 0) {
    return {
      status: "skipped",
      detail: "no vendored ffmpeg/ffprobe available; runtime resolves via PATH",
    };
  }
  return { status: "already", detail: `nothing to do (${dir})` };
}

/**
 * Provision the TTS venv (edge-tts + stable-ts) under ~/.autoviral/tts-venv —
 * the same steps as src/infra/python-env.ts.ensureTtsVenv(): probe python3,
 * `python3 -m venv`, then `<venv>/bin/python -m pip install --upgrade edge-tts
 * stable-ts`. Streams pip output via `report` so a multi-second install isn't a
 * blank stall. Idempotent (skips when both deps are already present).
 */
export async function installTtsVenv(
  report: ProgressReporter,
  spawner: Spawner = realSpawner,
): Promise<InstallResult> {
  if (probeTts().ready) {
    return { status: "already", detail: "edge-tts + stable-ts already installed" };
  }

  // (1) python3 present?
  report("  probing python3 …");
  let pyOk = false;
  try {
    const probe = await spawner("python3", ["--version"]);
    pyOk = probe.code === 0;
  } catch {
    pyOk = false;
  }
  if (!pyOk) {
    return {
      status: "failed",
      detail:
        "python3 not found — install Python 3 (e.g. `brew install python` on macOS) then re-run `autoviral setup`",
    };
  }

  const dir = ttsVenvDir();
  const venvPy =
    process.platform === "win32"
      ? join(dir, "Scripts", "python.exe")
      : join(dir, "bin", "python3");

  // (2) create venv if missing.
  if (!existsSync(venvPy)) {
    report(`  creating venv at ${dir} …`);
    const venv = await spawner("python3", ["-m", "venv", dir], {
      onLine: (l) => report(`    ${l}`),
    });
    if (venv.code !== 0) {
      return {
        status: "failed",
        detail: `python3 -m venv exited ${venv.code}: ${venv.stderr.slice(0, 200)}`,
      };
    }
  }

  // (3) pip install edge-tts + stable-ts (--upgrade keeps a re-run idempotent).
  report("  pip install --upgrade edge-tts stable-ts (this can take a minute) …");
  const pip = await spawner(
    venvPy,
    ["-m", "pip", "install", "--upgrade", "edge-tts", "stable-ts"],
    { onLine: (l) => report(`    ${l}`) },
  );
  if (pip.code !== 0) {
    return {
      status: "failed",
      detail: `pip exited ${pip.code}: ${pip.stderr.slice(0, 200)}`,
    };
  }
  return { status: "installed", detail: `edge-tts + stable-ts installed into ${dir}` };
}

/**
 * Install Playwright's chromium (heavy, ~150MB) — only when the user opts in
 * with `autoviral setup --heavy`. Mirrors python-env.ts.ensurePlaywrightChromium:
 * resolve the bundled CLI's absolute path, run it under the current node, stream
 * download progress. Skips when chromium is already cached.
 */
export async function installPlaywrightChromium(
  report: ProgressReporter,
  spawner: Spawner = realSpawner,
): Promise<InstallResult> {
  if (probePlaywright().cached) {
    return { status: "already", detail: "chromium already cached" };
  }
  const cli = resolvePlaywrightCli();
  report("  downloading chromium (~150MB) …");
  const r = cli
    ? await spawner(process.execPath, [cli, "install", "chromium"], {
        onLine: (l) => report(`    ${l}`),
      })
    : await spawner("npx", ["playwright", "install", "chromium"], {
        onLine: (l) => report(`    ${l}`),
      });
  if (r.code !== 0) {
    return {
      status: "failed",
      detail: `playwright install chromium exited ${r.code}: ${r.stderr.slice(0, 200)}`,
    };
  }
  return { status: "installed", detail: "chromium installed" };
}

function resolvePlaywrightCli(): string | null {
  for (const spec of ["playwright/cli.js", "@playwright/test/cli.js"]) {
    try {
      return require.resolve(spec);
    } catch {
      // try next
    }
  }
  return null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

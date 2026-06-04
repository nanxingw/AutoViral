// Python venv auto-bootstrap — PRD-0003 §1, slice I15.
//
// AutoViral's TTS fallback (edge-tts) and ASR/captions (stable-ts) are Python
// CLIs that historically required the user to hand-run `pip install`. On a
// clean machine that meant TTS-narration and ASR-subtitles silently 503'd with
// an opaque "PYTHON_DEP_MISSING" until the user figured out the pip incantation
// (and stable-ts vs stable-whisper is a known trap — see
// reference_stable_whisper_pypi). This module makes both deps SELF-PROVISIONING:
// on first TTS/ASR use we idempotently create `<dataDir>/tts-venv` and pip-
// install edge-tts + stable-ts into it, then resolve the venv's absolute binary
// paths. No system PATH dependency, no manual install.
//
// Design mirrors deps.ts (the ffmpeg/ffprobe managed-binary resolver, I13):
//
//   * the venv lives under <dataDir> = AUTOVIRAL_DATA_DIR ?? ~/.autoviral, so
//     tests stay isolated and the path matches every other managed artifact;
//   * path resolution is a PURE READ (never spawns) — merely importing a
//     spawn-site module can't trigger a multi-second pip install;
//   * ensureTtsVenv() is the explicit, best-effort, idempotent provisioner,
//     called LAZILY before the first TTS/ASR use (not at server boot — a big
//     pip install must never block the daemon coming up);
//   * concurrent callers share one in-flight promise so a burst doesn't run
//     `python3 -m venv` N times.
//
// Heavy / optional deps (playwright chromium ~150MB, whisper models GB-scale)
// are NOT force-installed at boot. ensurePlaywrightChromium() lazily downloads
// chromium on first trends-scrape use and surfaces progress via a callback.

import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataDir } from "./config.js";

const require = createRequire(import.meta.url);

// ── venv path resolution (pure reads — never spawn) ──────────────────────────

/** The managed TTS venv root, e.g. <dataDir>/tts-venv. Honours
 *  AUTOVIRAL_DATA_DIR via dataDir, so tests stay isolated. */
export function ttsVenvDir(): string {
  return join(dataDir, "tts-venv");
}

/** Platform-correct path to a console-script inside the venv (venv layout
 *  differs on Windows: Scripts/<name>.exe vs bin/<name>). */
export function venvBinPath(name: string): string {
  if (process.platform === "win32") {
    return join(ttsVenvDir(), "Scripts", `${name}.exe`);
  }
  return join(ttsVenvDir(), "bin", name);
}

/** Absolute path to the venv's Python interpreter (used to import stable_whisper
 *  for ASR — the import must run under the SAME interpreter pip installed into).
 *  Falls back to bare "python3" when the venv hasn't been provisioned yet, so a
 *  caller that skips ensureTtsVenv() still degrades to the host interpreter. */
export function venvPythonPath(): string {
  const p =
    process.platform === "win32"
      ? join(ttsVenvDir(), "Scripts", "python.exe")
      : join(ttsVenvDir(), "bin", "python3");
  return existsSync(p) ? p : "python3";
}

/** True when the edge-tts console-script exists inside the venv. Pure read.
 *  Necessary-but-not-sufficient for full readiness — see ttsVenvReady(). */
function edgeTtsPresent(): boolean {
  return existsSync(venvBinPath("edge-tts"));
}

/** True when stable-ts (import alias `stable_whisper`) is present in the venv's
 *  site-packages. Pure read — stable-ts installs NO console-script, so unlike
 *  edge-tts we can't probe a bin; we look for the package dir under the venv's
 *  site-packages instead.
 *
 *  Layout differs by platform: POSIX uses `lib/python3.X/site-packages`, Windows
 *  uses `Lib/site-packages`. The minor version is part of the POSIX path so we
 *  glob the `lib/python*` dirs rather than guess the interpreter version. */
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
    return false; // venv (or its lib/) not created yet.
  }
  for (const e of entries) {
    if (!e.startsWith("python")) continue;
    if (existsSync(join(libDir, e, "site-packages", "stable_whisper"))) return true;
  }
  return false;
}

/** True once the venv has BOTH managed deps — the edge-tts console-script AND
 *  the stable-ts (`stable_whisper`) package — i.e. a previous ensureTtsVenv()
 *  fully provisioned it. Pure read; safe to call anywhere.
 *
 *  WHY BOTH (live-reproduced bug): a venv created by an early edge-tts-only path
 *  (TTS used before ASR) has edge-tts but NOT stable-ts. If readiness probed
 *  edge-tts alone, ensureTtsVenv() would short-circuit "already provisioned" and
 *  the captions/ingest ASR path would 503 forever with a manual pip hint. Gating
 *  on both deps forces ensureTtsVenv() to re-run the (idempotent, --upgrade) pip
 *  step and back-fill the missing dep. */
export function ttsVenvReady(): boolean {
  return edgeTtsPresent() && stableTsPresent();
}

// ── injectable spawner (so unit tests never run real venv/pip) ───────────────

/** Result of a single spawned command. */
export interface SpawnResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

/** Run a command, capturing exit code + stdio. Injectable so tests can mock the
 *  whole child_process layer without ever creating a venv or hitting PyPI. */
export type Spawner = (
  cmd: string,
  args: string[],
  opts?: SpawnOptions,
) => Promise<SpawnResult>;

/** Default real spawner — promisified spawn with captured stdio. */
const realSpawner: Spawner = (cmd, args, opts) =>
  new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });

// ── ensureTtsVenv() — idempotent provisioner (best-effort, lazy) ─────────────

/** Raised when python3 itself is unavailable — distinct from a pip failure so
 *  the caller can surface the right "install Python" vs "install failed" hint.
 *  errorCode mirrors the audio router's PYTHON_DEP_MISSING contract. */
export class PythonMissingError extends Error {
  readonly errorCode = "PYTHON_DEP_MISSING";
  constructor(message: string) {
    super(message);
    this.name = "PythonMissingError";
  }
}

export interface EnsureTtsVenvOptions {
  /** Injected for tests — defaults to the real promisified spawn. */
  spawner?: Spawner;
  /** Force a re-provision even if the venv looks ready (default false). */
  force?: boolean;
}

let ttsVenvInFlight: Promise<void> | null = null;

/** Authoritatively check whether stable-ts is importable under the venv
 *  interpreter, by running `<venvpy> -c "import stable_whisper"`. stable-ts
 *  ships no console-script, so this import-probe is the ground truth (the sync
 *  stableTsPresent() dir-check is only a cheap best-effort hint). Returns false
 *  on any non-zero exit or spawn error so a missing/broken dep triggers a
 *  (re)install rather than a false "ready". */
async function stableTsImportable(spawner: Spawner, venvPy: string): Promise<boolean> {
  try {
    const probe = await spawner(venvPy, ["-c", "import stable_whisper"]);
    return probe.code === 0;
  } catch {
    return false;
  }
}

/**
 * Idempotently provision <dataDir>/tts-venv with edge-tts + stable-ts.
 *
 * Steps (each skipped when already satisfied):
 *   1. if edge-tts AND stable-ts are both already present → no-op (idempotent).
 *      NB readiness requires BOTH deps, so a venv with only edge-tts (an early
 *      TTS-before-ASR machine) does NOT short-circuit here — it falls through to
 *      the pip step and back-fills stable-ts.
 *   2. verify python3 is runnable; if not → throw PythonMissingError with a
 *      copy-paste-able install hint (we cannot bundle a system Python here).
 *   3. `python3 -m venv <dataDir>/tts-venv` (skipped if the venv python exists).
 *   4. `<venv>/bin/python -m pip install --upgrade edge-tts stable-ts` — RUN
 *      whenever stable-ts isn't importable under the venv interpreter (probed
 *      via `import stable_whisper`), even if edge-tts already exists. --upgrade
 *      makes the re-run safe + idempotent on already-satisfied deps.
 *
 * Best-effort: a pip failure throws (so the caller can surface a real error to
 * the user) but creation NEVER runs twice concurrently — a burst of TTS calls
 * shares one in-flight promise. Returns once the venv is ready (or throws).
 *
 * LAZY by contract: callers invoke this right before the first TTS/ASR use, not
 * at daemon boot — `python3 -m venv` + pip download can take many seconds and
 * must never block the server starting.
 */
export async function ensureTtsVenv(opts: EnsureTtsVenvOptions = {}): Promise<void> {
  const spawner = opts.spawner ?? realSpawner;

  // (1) Already fully provisioned (BOTH deps on disk) → cheap idempotent exit
  // (no spawn, no in-flight). A venv missing stable-ts fails this and proceeds.
  if (!opts.force && ttsVenvReady()) return;

  // Coalesce concurrent provisioners onto a single run.
  if (ttsVenvInFlight) return ttsVenvInFlight;

  ttsVenvInFlight = (async () => {
    try {
      // Re-check inside the in-flight guard: another caller may have finished
      // provisioning between our entry and acquiring the lock.
      if (!opts.force && ttsVenvReady()) return;

      // (2) python3 present?  `python3 --version` is the cheapest probe.
      try {
        const probe = await spawner("python3", ["--version"]);
        if (probe.code !== 0) {
          throw new PythonMissingError(
            `python3 is required for TTS (edge-tts) and ASR (stable-ts) but \`python3 --version\` exited ${probe.code}. ` +
              `Install Python 3 (e.g. \`brew install python\` on macOS) and retry.`,
          );
        }
      } catch (err) {
        if (err instanceof PythonMissingError) throw err;
        // spawn 'error' (ENOENT) → python3 not on PATH at all.
        throw new PythonMissingError(
          `python3 was not found on PATH; it is required for TTS (edge-tts) and ASR (stable-ts). ` +
            `Install Python 3 (e.g. \`brew install python\` on macOS) and retry. (${err instanceof Error ? err.message : String(err)})`,
        );
      }

      const dir = ttsVenvDir();
      await mkdir(dataDir, { recursive: true });

      // (3) Create the venv if its interpreter doesn't exist yet.
      const venvPy =
        process.platform === "win32"
          ? join(dir, "Scripts", "python.exe")
          : join(dir, "bin", "python3");
      if (!existsSync(venvPy)) {
        const venv = await spawner("python3", ["-m", "venv", dir]);
        if (venv.code !== 0) {
          throw new Error(
            `Failed to create TTS venv at ${dir} (python3 -m venv exited ${venv.code}): ${venv.stderr.slice(0, 500)}`,
          );
        }
      }

      // (4) pip-install edge-tts + stable-ts into the venv — but only when
      // stable-ts isn't already importable under the venv interpreter (or when
      // forced). This authoritative `import stable_whisper` probe is what lets
      // an edge-tts-only venv (TTS used before ASR) self-heal: edge-tts exists,
      // ttsVenvReady() was false because stable-ts is absent, the probe returns
      // non-zero, and we (re)run pip to back-fill it. A fully-provisioned venv
      // skips the pip step entirely (cheap idempotent path).
      if (!opts.force && (await stableTsImportable(spawner, venvPy))) return;

      // We invoke pip via the venv python (`-m pip`) so it always targets the
      // venv, never the host site-packages. --upgrade keeps a re-run current
      // without erroring on "already satisfied", so re-running is safe +
      // idempotent. NB: the PyPI package is `stable-ts` (the import alias is
      // `stable_whisper`) — see reference_stable_whisper_pypi.
      const pip = await spawner(venvPy, [
        "-m",
        "pip",
        "install",
        "--upgrade",
        "edge-tts",
        "stable-ts",
      ]);
      if (pip.code !== 0) {
        throw new Error(
          `Failed to install edge-tts/stable-ts into ${dir} (pip exited ${pip.code}): ${pip.stderr.slice(0, 500)}`,
        );
      }
    } finally {
      ttsVenvInFlight = null;
    }
  })();

  return ttsVenvInFlight;
}

// ── ensurePlaywrightChromium() — lazy heavy dep (trends scrape) ───────────────

/** Progress sink for the chromium download — the trends scrape route can wire
 *  this to a UI toast / log line so a ~150MB download isn't a blank stall. */
export type ProgressReporter = (line: string) => void;

export interface EnsurePlaywrightOptions {
  spawner?: Spawner;
  /** Surfaced progress lines (download %, "browser already installed", …). */
  onProgress?: ProgressReporter;
  /** Force a re-install even if a cached browser looks present. */
  force?: boolean;
}

let playwrightInFlight: Promise<void> | null = null;

/** Default per-platform Playwright browsers cache dir, honouring the
 *  PLAYWRIGHT_BROWSERS_PATH override (which Playwright itself respects). This is
 *  where `playwright install chromium` drops the `chromium-<build>` folder. */
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
  // Linux: XDG cache, default ~/.cache.
  const xdg = process.env.XDG_CACHE_HOME;
  return join(xdg && xdg.trim() ? xdg : join(homedir(), ".cache"), "ms-playwright");
}

/** True when a chromium build already sits in the Playwright browsers cache —
 *  the cheap readiness short-circuit that lets us skip the few-hundred-ms
 *  `playwright install` spawn on every scrape. Pure read; never spawns. */
function chromiumCached(): boolean {
  const cacheDir = playwrightBrowsersCacheDir();
  let entries: string[];
  try {
    entries = readdirSync(cacheDir);
  } catch {
    return false; // cache dir not created yet → nothing installed.
  }
  return entries.some((e) => e.startsWith("chromium"));
}

/** Absolute path to the bundled Playwright CLI, or `null` if it can't be
 *  resolved. Mirrors deps.ts's vendored-absolute-path philosophy: resolving the
 *  CLI's real path (instead of bare `npx`) means a stripped PATH — common when
 *  the daemon spawns under a packaged app — can't break the install spawn. */
function resolvePlaywrightCli(): string | null {
  // @playwright/test ships the `playwright` CLI as `cli.js`; the bare
  // `playwright` package re-exports the same. Try both so whichever is in
  // node_modules resolves.
  for (const spec of ["playwright/cli.js", "@playwright/test/cli.js"]) {
    try {
      return require.resolve(spec);
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Lazily ensure Playwright's chromium browser is installed (first trends-scrape
 * use). Short-circuits to a no-op when chromium is already in the browsers
 * cache; otherwise runs `playwright install chromium`, downloading ~150MB.
 * NEVER called at install/boot — only on first use, per PRD-0003 §1's layered
 * strategy (heavy optional deps download on first use, with progress, not at
 * install time).
 *
 * The CLI is resolved to its absolute bundled path (not bare `npx`) so a
 * stripped PATH can't break the spawn — consistent with deps.ts. If the path
 * can't be resolved we fall back to `npx playwright …`.
 *
 * Progress is surfaced line-by-line via opts.onProgress so the caller can show
 * the user a download indicator instead of a frozen blank.
 *
 * Best-effort + coalesced: concurrent scrapes share one in-flight install.
 * A failure throws so the caller can fall back / report; it does not retry here.
 */
export async function ensurePlaywrightChromium(
  opts: EnsurePlaywrightOptions = {},
): Promise<void> {
  const onProgress = opts.onProgress;
  const report = (line: string) => {
    if (onProgress) onProgress(line);
  };

  // Cheap readiness short-circuit: a cached chromium build means there's
  // nothing to do, so we skip the install spawn entirely (no PATH dependency,
  // no few-hundred-ms tax on every scrape).
  if (!opts.force && chromiumCached()) {
    report("[playwright] chromium already cached.");
    return;
  }

  if (playwrightInFlight) return playwrightInFlight;

  playwrightInFlight = (async () => {
    try {
      report("[playwright] ensuring chromium is installed…");
      const spawner: Spawner =
        opts.spawner ??
        ((cmd, args, sopts) =>
          new Promise<SpawnResult>((resolve, reject) => {
            const child = spawn(cmd, args, { ...sopts });
            let stdout = "";
            let stderr = "";
            // Stream both pipes to the progress reporter so the ~150MB download
            // shows live percentage instead of a blank wait.
            child.stdout?.on("data", (d) => {
              const s = d.toString();
              stdout += s;
              report(s.trimEnd());
            });
            child.stderr?.on("data", (d) => {
              const s = d.toString();
              stderr += s;
              report(s.trimEnd());
            });
            child.on("error", reject);
            child.on("close", (code) => resolve({ code, stderr, stdout }));
          }));

      // Resolve the playwright CLI to its absolute bundled path and run it with
      // the current node binary (`process.execPath`) — no PATH dependency. Only
      // the chromium browser is fetched (not firefox/webkit), and it's
      // idempotent. Fall back to bare `npx playwright …` only when the absolute
      // path can't be resolved (e.g. an unexpected node_modules layout).
      const cli = resolvePlaywrightCli();
      const r = cli
        ? await spawner(process.execPath, [cli, "install", "chromium"])
        : await spawner("npx", ["playwright", "install", "chromium"]);
      if (r.code !== 0) {
        throw new Error(
          `playwright install chromium failed (exit ${r.code}): ${r.stderr.slice(0, 500)}`,
        );
      }
      report("[playwright] chromium ready.");
    } finally {
      playwrightInFlight = null;
    }
  })();

  return playwrightInFlight;
}

// ── whisper model lazy-download hook ─────────────────────────────────────────
//
// The ASR path (stable_whisper.load_model("base")) downloads the whisper model
// (GB-scale for larger sizes) the FIRST time it runs, into the user's HF/torch
// cache — that download is owned by stable-ts itself, not us, so there is no
// separate binary to provision. We expose this hook purely so a caller (or a
// future "warm the model" setup step) has ONE documented place to trigger /
// surface that first-run download instead of scattering the knowledge. It is
// intentionally lazy + best-effort: never called at boot.
//
// (No-op body today: load_model downloads on demand inside the ASR subprocess.
// This stub exists so the lazy-download policy is discoverable and a progress
// hook can be wired here without touching the ASR route.)
export function whisperModelLazyDownloadNote(): string {
  return (
    "stable_whisper.load_model(...) downloads the whisper model on first ASR use " +
    "into the host HF/torch cache; it is not provisioned at install/boot."
  );
}

// ── test-only reset ──────────────────────────────────────────────────────────

/** Clear in-flight guards so idempotency / concurrency tests can re-run under a
 *  freshly mutated env / filesystem. */
export function _resetPythonEnvForTests(): void {
  ttsVenvInFlight = null;
  playwrightInFlight = null;
}

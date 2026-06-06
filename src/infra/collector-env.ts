// Douyin-collector managed venv — PRD-0006 §D4 (dependency layer), slice S4.
//
// The Douyin analytics collector needs two Python deps the host machine almost
// never has: `f2` (which already solves the a_bogus/X-Bogus request-signing the
// Douyin API requires — the whole reason the user decided on a managed Python
// venv rather than a pure-TS rewrite) and `browser_cookie3` (to read the user's
// already-logged-in douyin.com sessionid cookie). Before this slice the
// collector script was retired (#72) and any future revival would have spawned
// python3 against deps that aren't installed — yet another SILENT ENOENT.
//
// This module makes those deps SELF-PROVISIONING, reusing the EXACT venv
// mechanism v0.1.2 built for TTS (src/infra/python-env.ts: ensureTtsVenv /
// ttsVenvReady). It deliberately keeps a SEPARATE venv (<dataDir>/collector-venv)
// from the TTS venv so the two concerns have independent readiness + independent
// doctor rows — a missing collector dep never makes the TTS venv look broken and
// vice-versa.
//
// Design mirrors python-env.ts / deps.ts:
//   * the venv lives under <dataDir> = AUTOVIRAL_DATA_DIR ?? ~/.autoviral, so
//     tests stay isolated and the path matches every other managed artifact;
//   * path resolution is a PURE READ (never spawns) — importing a spawn-site
//     module can't trigger a multi-second pip install;
//   * ensureCollectorVenv() is the explicit, best-effort, idempotent provisioner,
//     called LAZILY before the first collector use (and by `autoviral setup`),
//     not at server boot — a big pip install must never block the daemon;
//   * concurrent callers share one in-flight promise so a burst doesn't run
//     `python3 -m venv` N times.
//
// HONESTY (the whole point of S4): collectorVenvReady() reports present-vs-
// missing truthfully so doctor surfaces a gap instead of a silent ENOENT.

import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./config.js";
import {
  PythonMissingError,
  type EnsureTtsVenvOptions,
  type Spawner,
} from "./python-env.js";

// Re-export PythonMissingError so collector-env callers (and tests) have a
// single import surface — the "python3 itself is missing" failure mode is shared
// with python-env.ts and must stay one error type, not two divergent ones.
export { PythonMissingError } from "./python-env.js";

// The two managed collector deps. `f2` ships a console-script (`f2`) we can
// probe directly; `browser_cookie3` ships NO console-script, so we look for its
// package dir under site-packages (same trick python-env uses for stable-ts).
const PIP_PACKAGES = ["f2", "browser_cookie3"] as const;
/** Import alias used by the authoritative `import …` readiness probe. */
const COOKIE_IMPORT = "browser_cookie3";

// ── venv path resolution (pure reads — never spawn) ──────────────────────────

/** The managed collector venv root, e.g. <dataDir>/collector-venv. Honours
 *  AUTOVIRAL_DATA_DIR via dataDir, so tests stay isolated. */
export function collectorVenvDir(): string {
  return join(dataDir, "collector-venv");
}

/** Platform-correct path to a console-script inside the venv (venv layout
 *  differs on Windows: Scripts/<name>.exe vs bin/<name>). */
export function collectorVenvBinPath(name: string): string {
  if (process.platform === "win32") {
    return join(collectorVenvDir(), "Scripts", `${name}.exe`);
  }
  return join(collectorVenvDir(), "bin", name);
}

/** Absolute path to the collector venv's Python interpreter — the collector
 *  subprocess (S5) must run under the SAME interpreter pip installed f2 +
 *  browser_cookie3 into. Falls back to bare "python3" when the venv hasn't been
 *  provisioned yet, so a caller that skips ensureCollectorVenv() still degrades
 *  to the host interpreter rather than crashing on an absent path. */
export function collectorVenvPythonPath(): string {
  const p =
    process.platform === "win32"
      ? join(collectorVenvDir(), "Scripts", "python.exe")
      : join(collectorVenvDir(), "bin", "python3");
  return existsSync(p) ? p : "python3";
}

/** True when the f2 console-script exists inside the venv. Pure read.
 *  Necessary-but-not-sufficient for full readiness — see collectorVenvReady(). */
function f2Present(): boolean {
  return existsSync(collectorVenvBinPath("f2"));
}

/** True when browser_cookie3 is present in the venv's site-packages. Pure read —
 *  browser_cookie3 installs NO console-script, so unlike f2 we can't probe a bin;
 *  we look for the package dir under the venv's site-packages instead.
 *
 *  Layout differs by platform: POSIX uses `lib/python3.X/site-packages`, Windows
 *  uses `Lib/site-packages`. The minor version is part of the POSIX path so we
 *  glob the `lib/python*` dirs rather than guess the interpreter version. */
function browserCookie3Present(): boolean {
  const root = collectorVenvDir();
  if (process.platform === "win32") {
    return existsSync(join(root, "Lib", "site-packages", "browser_cookie3"));
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
    if (existsSync(join(libDir, e, "site-packages", "browser_cookie3"))) return true;
  }
  return false;
}

/** True once the venv has BOTH managed deps — the f2 console-script AND the
 *  browser_cookie3 package — i.e. a previous ensureCollectorVenv() fully
 *  provisioned it. Pure read; safe to call anywhere (doctor relies on this).
 *
 *  WHY BOTH (same trap python-env.ts hit for edge-tts/stable-ts): a venv created
 *  by an f2-only path would have f2 but not browser_cookie3. If readiness probed
 *  f2 alone, ensureCollectorVenv() would short-circuit "already provisioned" and
 *  the cookie-read path would fail forever. Gating on both deps forces
 *  ensureCollectorVenv() to re-run the (idempotent, --upgrade) pip step and
 *  back-fill the missing dep. */
export function collectorVenvReady(): boolean {
  return f2Present() && browserCookie3Present();
}

// ── ensureCollectorVenv() — idempotent provisioner (best-effort, lazy) ───────

let collectorVenvInFlight: Promise<void> | null = null;

/** Authoritatively check whether browser_cookie3 is importable under the venv
 *  interpreter, by running `<venvpy> -c "import browser_cookie3"`. browser_cookie3
 *  ships no console-script, so this import-probe is the ground truth (the sync
 *  browserCookie3Present() dir-check is only a cheap best-effort hint). Returns
 *  false on any non-zero exit or spawn error so a missing/broken dep triggers a
 *  (re)install rather than a false "ready". */
async function cookieImportable(spawner: Spawner, venvPy: string): Promise<boolean> {
  try {
    const probe = await spawner(venvPy, ["-c", `import ${COOKIE_IMPORT}`]);
    return probe.code === 0;
  } catch {
    return false;
  }
}

/**
 * Idempotently provision <dataDir>/collector-venv with f2 + browser_cookie3.
 *
 * Steps (each skipped when already satisfied):
 *   1. if f2 AND browser_cookie3 are both already present → no-op (idempotent).
 *      NB readiness requires BOTH deps, so an f2-only venv does NOT short-circuit
 *      here — it falls through to the pip step and back-fills browser_cookie3.
 *   2. verify python3 is runnable; if not → throw PythonMissingError with a
 *      copy-paste-able install hint (we cannot bundle a system Python here).
 *   3. `python3 -m venv <dataDir>/collector-venv` (skipped if its python exists).
 *   4. `<venv>/bin/python -m pip install --upgrade f2 browser_cookie3` — RUN
 *      whenever browser_cookie3 isn't importable under the venv interpreter
 *      (probed via `import browser_cookie3`), even if f2 already exists.
 *      --upgrade makes the re-run safe + idempotent on already-satisfied deps.
 *
 * Best-effort: a pip failure throws (so the caller can surface a real error)
 * but creation NEVER runs twice concurrently — a burst of refresh calls shares
 * one in-flight promise. Returns once the venv is ready (or throws).
 *
 * LAZY by contract: callers invoke this right before the first collector use (or
 * via `autoviral setup`), not at daemon boot — `python3 -m venv` + a pip
 * download can take many seconds and must never block the server starting.
 */
export async function ensureCollectorVenv(opts: EnsureTtsVenvOptions = {}): Promise<void> {
  const spawner = opts.spawner ?? realSpawner;

  // (1) Already fully provisioned (BOTH deps on disk) → cheap idempotent exit
  // (no spawn, no in-flight). A venv missing browser_cookie3 fails this + proceeds.
  if (!opts.force && collectorVenvReady()) return;

  // Coalesce concurrent provisioners onto a single run.
  if (collectorVenvInFlight) return collectorVenvInFlight;

  collectorVenvInFlight = (async () => {
    try {
      // Re-check inside the in-flight guard: another caller may have finished
      // provisioning between our entry and acquiring the lock.
      if (!opts.force && collectorVenvReady()) return;

      // (2) python3 present?  `python3 --version` is the cheapest probe.
      try {
        const probe = await spawner("python3", ["--version"]);
        if (probe.code !== 0) {
          throw new PythonMissingError(
            `python3 is required for the Douyin collector (f2 + browser_cookie3) but ` +
              `\`python3 --version\` exited ${probe.code}. ` +
              `Install Python 3 (e.g. \`brew install python\` on macOS) and retry.`,
          );
        }
      } catch (err) {
        if (err instanceof PythonMissingError) throw err;
        // spawn 'error' (ENOENT) → python3 not on PATH at all.
        throw new PythonMissingError(
          `python3 was not found on PATH; it is required for the Douyin collector ` +
            `(f2 + browser_cookie3). Install Python 3 (e.g. \`brew install python\` on ` +
            `macOS) and retry. (${err instanceof Error ? err.message : String(err)})`,
        );
      }

      const dir = collectorVenvDir();
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
            `Failed to create collector venv at ${dir} (python3 -m venv exited ${venv.code}): ${venv.stderr.slice(0, 500)}`,
          );
        }
      }

      // (4) pip-install f2 + browser_cookie3 into the venv — but only when
      // browser_cookie3 isn't already importable under the venv interpreter (or
      // when forced). This authoritative `import browser_cookie3` probe is what
      // lets an f2-only venv self-heal: f2 exists, collectorVenvReady() was false
      // because browser_cookie3 is absent, the probe returns non-zero, and we
      // (re)run pip to back-fill it. A fully-provisioned venv skips pip entirely.
      if (!opts.force && (await cookieImportable(spawner, venvPy))) return;

      // We invoke pip via the venv python (`-m pip`) so it always targets the
      // venv, never the host site-packages. --upgrade keeps a re-run current
      // without erroring on "already satisfied", so re-running is safe +
      // idempotent.
      const pip = await spawner(venvPy, [
        "-m",
        "pip",
        "install",
        "--upgrade",
        ...PIP_PACKAGES,
      ]);
      if (pip.code !== 0) {
        throw new Error(
          `Failed to install f2/browser_cookie3 into ${dir} (pip exited ${pip.code}): ${pip.stderr.slice(0, 500)}`,
        );
      }
    } finally {
      collectorVenvInFlight = null;
    }
  })();

  return collectorVenvInFlight;
}

// ── default real spawner ─────────────────────────────────────────────────────
//
// Reuses python-env's Spawner shape. We re-implement the promisified spawn here
// (rather than export python-env's private realSpawner) to keep python-env's
// surface unchanged; the contract is identical.

import { spawn } from "node:child_process";

const realSpawner: Spawner = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });

// ── test-only reset ──────────────────────────────────────────────────────────

/** Clear the in-flight guard so idempotency / concurrency tests can re-run under
 *  a freshly mutated env / filesystem. */
export function _resetCollectorEnvForTests(): void {
  collectorVenvInFlight = null;
}
